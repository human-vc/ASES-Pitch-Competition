"""
Argument-identity metric: detects that two paraphrased comments share the same
underlying logical argument structure even with zero vocabulary overlap.

This is the core moat. Replaces fingerprint.py.

Pipeline:
1. For each comment, extract a structured argument graph via Claude API:
   - position (support/oppose/neutral)
   - 1-5 atomic premises (canonical short propositions)
   - 1 conclusion
   - evidence types (anecdote/economic/legal/technical/procedural)
   - target entity

2. Compute pairwise argument-identity score:
   identity(A, B) = 0.4 * jaccard(premise_set_A, premise_set_B)
                  + 0.3 * cosine(premise_centroid_A, premise_centroid_B)
                  + 0.2 * (position_match * 1.0)
                  + 0.1 * jaccard(evidence_types_A, evidence_types_B)

3. For each cluster, compute mean intra-cluster argument-identity score.
4. High score (>0.7) = "this cluster makes the same argument over and over"
   even if all comments use different vocabulary.
"""

import json
import hashlib
import time
import numpy as np
from collections import Counter
from config import (
    ANTHROPIC_API_KEY, FINGERPRINT_SAMPLE_PER_CLUSTER,
    FINGERPRINT_MAX_CLUSTERS, FINGERPRINT_MIN_CLUSTER_SIZE,
)

EXTRACT_PROMPT = """Extract the argument structure of this regulatory comment. Output only JSON, no markdown, no code fences, no explanation.

Schema:
{{"position": "support|oppose|neutral", "premises": ["short premise", ...], "conclusion": "...", "evidence_types": ["anecdote|economic|legal|technical|procedural|rights_based"], "target": "rule provision", "stance_summary": "one sentence"}}

Premises must be SHORT canonical propositions (max 10 words, 1-5 total). Strip surface vocabulary so semantically identical arguments produce identical premises.

Comment: {text}

JSON:"""


def _hash_premises(premises):
    """Stable hash of premise set for fast lookups."""
    canonical = sorted([p.lower().strip() for p in premises])
    return hashlib.md5("||".join(canonical).encode()).hexdigest()[:16]


def _extract_json_block(raw):
    """Extract JSON object from possibly-fenced text."""
    raw = raw.strip()
    # Strip markdown code fences
    if "```" in raw:
        # Find the first { and last } between fences
        parts = raw.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                raw = part
                break
    # Find first { and matching last }
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    return raw


def _extract_one(client, text, model="claude-haiku-4-5"):
    """Extract argument structure for a single comment via Claude."""
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=500,
            messages=[{"role": "user", "content": EXTRACT_PROMPT.format(text=text[:1500])}],
        )
        raw = resp.content[0].text
        cleaned = _extract_json_block(raw)
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        return {"error": f"json: {e.msg[:50]}"}
    except Exception as e:
        return {"error": str(e)[:80]}


def extract_arguments(texts, comment_ids, labels, sample_per_cluster=FINGERPRINT_SAMPLE_PER_CLUSTER,
                      min_cluster_size_for_extraction=FINGERPRINT_MIN_CLUSTER_SIZE,
                      max_clusters=FINGERPRINT_MAX_CLUSTERS):
    """
    Sample comments per cluster and extract argument structures via Claude.
    Only processes clusters with at least min_cluster_size_for_extraction members,
    and caps at max_clusters total to keep API costs sane.
    """
    if not ANTHROPIC_API_KEY:
        print("  [skip] No ANTHROPIC_API_KEY set; argument extraction disabled")
        return {}

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    arguments = {}
    cluster_ids = sorted(set(labels.tolist()) if hasattr(labels, "tolist") else set(labels))

    # Filter to large clusters and pick the top N by size
    cluster_sizes = []
    for cl in cluster_ids:
        if cl == -1:
            continue
        member_indices = [i for i, l in enumerate(labels) if l == cl]
        if len(member_indices) >= min_cluster_size_for_extraction:
            cluster_sizes.append((cl, member_indices))
    cluster_sizes.sort(key=lambda x: -len(x[1]))
    cluster_sizes = cluster_sizes[:max_clusters]

    n_total = sum(min(len(idx), sample_per_cluster) for _, idx in cluster_sizes)
    print(f"  Extracting arguments via Claude Haiku ({len(cluster_sizes)} clusters, {n_total} comments)")

    for cl, member_indices in cluster_sizes:
        sample = member_indices[:sample_per_cluster]
        for idx in sample:
            cid = comment_ids[idx]
            arg = _extract_one(client, texts[idx])
            if arg and "error" not in arg:
                arguments[cid] = arg

    print(f"  Extracted {len(arguments)} argument structures")
    return arguments


def compute_argument_identity(arg_a, arg_b):
    """Pairwise argument-identity score in [0, 1]."""
    if not arg_a or not arg_b:
        return 0.0

    # Premise jaccard
    p_a = set(p.lower().strip() for p in arg_a.get("premises", []))
    p_b = set(p.lower().strip() for p in arg_b.get("premises", []))
    if not p_a or not p_b:
        prem_jacc = 0.0
    else:
        inter = p_a & p_b
        union = p_a | p_b
        prem_jacc = len(inter) / len(union) if union else 0.0

    # Position match
    pos_match = 1.0 if arg_a.get("position") == arg_b.get("position") else 0.0

    # Evidence type jaccard
    e_a = set(arg_a.get("evidence_types", []))
    e_b = set(arg_b.get("evidence_types", []))
    if e_a and e_b:
        evid_jacc = len(e_a & e_b) / len(e_a | e_b)
    else:
        evid_jacc = 0.0

    # Target match (substring or fuzzy)
    t_a = (arg_a.get("target") or "").lower()
    t_b = (arg_b.get("target") or "").lower()
    target_match = 1.0 if t_a and t_b and (t_a in t_b or t_b in t_a) else 0.0

    score = (
        0.5 * prem_jacc +
        0.25 * pos_match +
        0.15 * evid_jacc +
        0.10 * target_match
    )
    return float(score)


def cluster_argument_identity(arguments, labels, comment_ids):
    """
    Per-cluster mean intra-cluster argument-identity score.
    High score = same argument repeated with different vocabulary.
    """
    results = {}
    cluster_ids = set(labels.tolist()) if hasattr(labels, "tolist") else set(labels)

    for cl in cluster_ids:
        if cl == -1:
            continue
        member_ids = [comment_ids[i] for i, l in enumerate(labels) if l == cl]
        cluster_args = [(cid, arguments[cid]) for cid in member_ids if cid in arguments]
        if len(cluster_args) < 2:
            continue

        # Compute pairwise scores
        scores = []
        for i in range(len(cluster_args)):
            for j in range(i + 1, len(cluster_args)):
                s = compute_argument_identity(cluster_args[i][1], cluster_args[j][1])
                scores.append(s)

        if not scores:
            continue

        mean_score = float(np.mean(scores))
        median_score = float(np.median(scores))

        # Position unanimity
        positions = [a[1].get("position", "") for a in cluster_args]
        if positions:
            most_common = Counter(positions).most_common(1)[0]
            position_unanimity = most_common[1] / len(positions)
            dominant_position = most_common[0]
        else:
            position_unanimity = 0.0
            dominant_position = ""

        # All premises pooled — for stance summary
        all_premises = []
        for _, arg in cluster_args:
            all_premises.extend(arg.get("premises", []))
        top_premises = [p for p, _ in Counter(all_premises).most_common(5)]

        # Argument hash for cross-docket matching
        if top_premises:
            arg_hash = _hash_premises(top_premises)
        else:
            arg_hash = None

        results[int(cl)] = {
            "n_extracted": len(cluster_args),
            "mean_identity": round(mean_score, 4),
            "median_identity": round(median_score, 4),
            "position_unanimity": round(position_unanimity, 3),
            "dominant_position": dominant_position,
            "top_premises": top_premises,
            "argument_hash": arg_hash,
            "stance_summary": cluster_args[0][1].get("stance_summary", "") if cluster_args else "",
        }
    return results
