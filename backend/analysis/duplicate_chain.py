"""
Duplicate chain analysis: gradient from exact duplicates → near-duplicates →
paraphrased variants → loosely related comments. Used for the forensics drill-down.
"""

import numpy as np
from collections import defaultdict


def _hash_text(text):
    """Cheap canonical hash for exact-duplicate detection."""
    return hash(text.strip().lower())


def build_duplicate_chain(texts, embeddings, comment_ids, labels, dup_groups):
    """
    For each cluster, build a duplicate chain: count exact dups, near dups
    (from MinHash LSH), paraphrases (high embedding similarity).

    Returns dict[cluster_id -> chain_stats].
    """
    # Map comment_id -> index
    id_to_idx = {cid: i for i, cid in enumerate(comment_ids)}
    # Map comment_id -> dup group id
    id_to_dup_group = {}
    for gi, group in enumerate(dup_groups):
        for cid in group:
            id_to_dup_group[cid] = gi

    results = {}
    cluster_ids = set(labels.tolist()) if hasattr(labels, "tolist") else set(labels)

    for cl in cluster_ids:
        if cl == -1:
            continue
        member_indices = [i for i, l in enumerate(labels) if l == cl]
        n = len(member_indices)
        if n < 3:
            continue

        member_ids = [comment_ids[i] for i in member_indices]
        member_texts = [texts[i] for i in member_indices]

        # 1. Exact text dups (cheap hash)
        text_hashes = [_hash_text(t) for t in member_texts]
        from collections import Counter
        hash_counts = Counter(text_hashes)
        n_exact_dup = sum(c for c in hash_counts.values() if c > 1)
        n_unique_text = sum(1 for c in hash_counts.values() if c == 1)
        largest_exact_group = max(hash_counts.values()) if hash_counts else 0

        # 2. Near-dups via MinHash groups
        near_dup_groups = set()
        for cid in member_ids:
            if cid in id_to_dup_group:
                near_dup_groups.add(id_to_dup_group[cid])
        n_near_dup_members = sum(1 for cid in member_ids if cid in id_to_dup_group)

        # 3. Embedding-based paraphrase tightness
        # Compute pairwise cosine similarity within cluster (sample if large)
        if n > 100:
            sample_idx = np.random.choice(member_indices, 100, replace=False)
        else:
            sample_idx = member_indices
        emb_sample = embeddings[sample_idx]
        # Already L2-normalized
        sim_matrix = emb_sample @ emb_sample.T
        # Upper triangle, exclude diagonal
        triu = sim_matrix[np.triu_indices_from(sim_matrix, k=1)]
        if len(triu) > 0:
            mean_sim = float(np.mean(triu))
            median_sim = float(np.median(triu))
            min_sim = float(np.min(triu))
        else:
            mean_sim = median_sim = min_sim = 0.0

        # 4. Sophistication score: high similarity but few exact dups = paraphrased
        # Low similarity + few dups = organic
        # High dups = lazy template
        if n_exact_dup / n > 0.5:
            sophistication = "lazy_template"
        elif mean_sim > 0.85 and n_exact_dup / n < 0.1:
            sophistication = "ai_paraphrased"
        elif mean_sim > 0.75:
            sophistication = "near_duplicate"
        else:
            sophistication = "organic"

        results[int(cl)] = {
            "n_total": n,
            "n_exact_dup": n_exact_dup,
            "n_unique_text": n_unique_text,
            "largest_exact_group": largest_exact_group,
            "n_near_dup_members": n_near_dup_members,
            "n_near_dup_groups": len(near_dup_groups),
            "mean_pairwise_similarity": round(mean_sim, 4),
            "median_pairwise_similarity": round(median_sim, 4),
            "min_pairwise_similarity": round(min_sim, 4),
            "sophistication": sophistication,
        }

    return results
