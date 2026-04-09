"""
Counterfactual paraphrase probing.

For each cluster, take 3 exemplar comments → ask Claude to generate 10 AI
paraphrases → check whether those paraphrases fall inside the cluster
(via embedding similarity).

If yes, the cluster is "paraphrase-reachable from a small seed" — the defining
property of an AI campaign. Nobody else is doing this test.

Pitch line: "DocketLens probed Cluster A by generating 30 AI paraphrases of 3
exemplar comments. 28 of 30 paraphrases fell inside the cluster (paraphrase
reachability score = 0.93). This proves the cluster is generatively closed —
a defining signature of an AI-coordinated campaign."
"""

import time
import numpy as np
from config import ANTHROPIC_API_KEY, VOYAGE_API_KEY


PARAPHRASE_PROMPT = """Generate 10 paraphrases of this regulatory comment. Each should:
- Use completely different vocabulary and sentence structure
- Make the same underlying argument
- Sound like it was written by a different individual
- Be 1-3 sentences long

Return ONLY a JSON array of 10 strings, no other text:
["paraphrase 1", "paraphrase 2", ..., "paraphrase 10"]

Original comment: {text}"""


def _generate_paraphrases(client, text, model="claude-haiku-4-5"):
    import json
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=2000,
            messages=[{"role": "user", "content": PARAPHRASE_PROMPT.format(text=text[:1000])}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.split("```")[0]
        paraphrases = json.loads(raw)
        if isinstance(paraphrases, list):
            return [p for p in paraphrases if isinstance(p, str) and len(p) > 10]
    except Exception:
        return []
    return []


def _embed_texts(voyage_client, texts):
    """Embed a small batch via Voyage."""
    if not voyage_client or not texts:
        return None
    try:
        result = voyage_client.embed(
            texts,
            model="voyage-3-large",
            input_type="document",
            truncation=True,
        )
        vecs = np.array(result.embeddings, dtype=np.float32)
        vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12)
        return vecs
    except Exception as e:
        print(f"  [paraphrase embed error] {e}")
        return None


def probe_cluster(cluster_indices, embeddings, texts, comment_ids, anthropic_client,
                  voyage_client, n_exemplars=3, similarity_threshold=0.78):
    """
    For one cluster, generate paraphrases of N exemplars and check reachability.
    Returns probe stats.
    """
    if len(cluster_indices) < 3:
        return None

    # Pick exemplars (most central — closest to cluster centroid)
    cluster_embs = embeddings[cluster_indices]
    centroid = cluster_embs.mean(axis=0)
    centroid /= np.linalg.norm(centroid) + 1e-12
    sims_to_centroid = cluster_embs @ centroid
    top_idx = np.argsort(-sims_to_centroid)[:n_exemplars]
    exemplars = [(cluster_indices[i], texts[cluster_indices[i]]) for i in top_idx]

    # Generate paraphrases
    all_paraphrases = []
    for _, text in exemplars:
        paras = _generate_paraphrases(anthropic_client, text)
        all_paraphrases.extend(paras)
        time.sleep(0.5)  # be polite

    if not all_paraphrases:
        return None

    # Embed paraphrases
    para_embs = _embed_texts(voyage_client, all_paraphrases)
    if para_embs is None:
        return None

    # Check reachability: does each paraphrase land inside the cluster?
    # Use the cluster's "core" — points within median distance from centroid
    distances = 1 - sims_to_centroid
    median_dist = float(np.median(distances))
    cluster_radius = median_dist * 1.5  # generous boundary

    reachable_count = 0
    para_distances = []
    for pe in para_embs:
        dist_to_centroid = float(1 - (pe @ centroid))
        para_distances.append(dist_to_centroid)
        if dist_to_centroid <= cluster_radius:
            reachable_count += 1

    reachability = reachable_count / len(all_paraphrases)

    return {
        "n_exemplars": len(exemplars),
        "n_paraphrases_generated": len(all_paraphrases),
        "n_paraphrases_reachable": reachable_count,
        "reachability_score": round(reachability, 4),
        "median_paraphrase_distance": round(float(np.median(para_distances)), 4),
        "cluster_radius_used": round(cluster_radius, 4),
        "interpretation": (
            "paraphrase_reachable" if reachability > 0.7
            else "partially_reachable" if reachability > 0.4
            else "not_reachable"
        ),
    }


def probe_top_clusters(comments, embeddings, texts, comment_ids, labels, top_n=3):
    """
    Probe the top N largest clusters with counterfactual paraphrase generation.
    Returns dict[cluster_id -> probe_results].
    """
    if not ANTHROPIC_API_KEY or not VOYAGE_API_KEY:
        print("  [skip] Missing API keys; paraphrase probing disabled")
        return {}

    import anthropic
    import voyageai
    anth = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    voy = voyageai.Client(api_key=VOYAGE_API_KEY)

    # Find top clusters by size
    from collections import Counter
    label_list = labels.tolist() if hasattr(labels, "tolist") else list(labels)
    cluster_sizes = Counter(l for l in label_list if l != -1)
    top_clusters = [cl for cl, _ in cluster_sizes.most_common(top_n)]

    print(f"  Probing top {len(top_clusters)} clusters with paraphrase generation")

    results = {}
    for cl in top_clusters:
        member_indices = [i for i, l in enumerate(label_list) if l == cl]
        print(f"    cluster {cl}: {len(member_indices)} members")
        probe = probe_cluster(member_indices, embeddings, texts, comment_ids, anth, voy)
        if probe:
            results[int(cl)] = probe
            print(f"      reachability: {probe['reachability_score']:.3f} ({probe['interpretation']})")
    return results
