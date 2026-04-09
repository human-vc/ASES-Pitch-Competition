import json
import anthropic
from config import ANTHROPIC_API_KEY, FINGERPRINT_MODEL, FINGERPRINT_SAMPLE_PER_CLUSTER

PROMPT = """Analyze this regulatory comment and extract its argument structure as JSON:
{{
  "position": "support" or "oppose" or "neutral",
  "key_claims": ["claim1", "claim2", ...],
  "rhetorical_moves": ["personal_anecdote", "economic_argument", "rights_based", "technical", "procedural", "template_language"],
  "formality": "formal" or "informal" or "template",
  "specificity": "generic" or "specific_to_rule" or "highly_technical"
}}

Comment: {text}

Return ONLY valid JSON, no other text."""


def fingerprint_sample(texts, comment_ids, labels, model=FINGERPRINT_MODEL):
    if not ANTHROPIC_API_KEY:
        print("  [skip] No ANTHROPIC_API_KEY set, skipping fingerprinting")
        return {}

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    fingerprints = {}
    clusters = set(labels)

    for cl in clusters:
        if cl == -1:
            continue
        # Sample up to N comments from this cluster
        members = [(cid, texts[i]) for i, (cid, l) in enumerate(zip(comment_ids, labels)) if l == cl]
        sample = members[:FINGERPRINT_SAMPLE_PER_CLUSTER]

        print(f"  Fingerprinting cluster {cl}: {len(sample)} samples")
        for cid, text in sample:
            try:
                resp = client.messages.create(
                    model=model,
                    max_tokens=300,
                    messages=[{"role": "user", "content": PROMPT.format(text=text[:1000])}],
                )
                raw = resp.content[0].text.strip()
                # Try to parse JSON
                fp = json.loads(raw)
                fingerprints[cid] = fp
            except (json.JSONDecodeError, Exception) as e:
                fingerprints[cid] = {"error": str(e)}

    return fingerprints


def cluster_fingerprint_similarity(fingerprints, labels, comment_ids):
    stats = {}
    for cl in set(labels):
        if cl == -1:
            continue
        members = [cid for cid, l in zip(comment_ids, labels) if l == cl]
        fps = [fingerprints[cid] for cid in members if cid in fingerprints and "error" not in fingerprints[cid]]
        if len(fps) < 2:
            continue

        # Position unanimity
        positions = [fp.get("position", "") for fp in fps]
        most_common = max(set(positions), key=positions.count) if positions else ""
        position_unanimity = positions.count(most_common) / max(1, len(positions))

        # Rhetorical move overlap (avg Jaccard between all pairs)
        moves_sets = [set(fp.get("rhetorical_moves", [])) for fp in fps]
        jaccard_sum, pairs = 0, 0
        for i in range(len(moves_sets)):
            for j in range(i+1, len(moves_sets)):
                union = moves_sets[i] | moves_sets[j]
                inter = moves_sets[i] & moves_sets[j]
                if union:
                    jaccard_sum += len(inter) / len(union)
                pairs += 1

        # Formality unanimity
        formalities = [fp.get("formality", "") for fp in fps]
        form_common = max(set(formalities), key=formalities.count) if formalities else ""
        formality_unanimity = formalities.count(form_common) / max(1, len(formalities))

        stats[int(cl)] = {
            "position_unanimity": round(position_unanimity, 3),
            "rhetorical_jaccard": round(jaccard_sum / max(1, pairs), 3),
            "formality_unanimity": round(formality_unanimity, 3),
            "n_fingerprinted": len(fps),
            "dominant_position": most_common,
        }
    return stats
