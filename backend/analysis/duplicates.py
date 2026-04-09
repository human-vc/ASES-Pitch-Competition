import numpy as np
from datasketch import MinHash, MinHashLSH
from config import MINHASH_NUM_PERM, LSH_THRESHOLD


def _shingles(text, k=5):
    """Word-level k-shingles. k=5 words is much more discriminative than character k=3."""
    text = text.lower().strip()
    words = text.split()
    if len(words) < k:
        return {" ".join(words)}
    return {" ".join(words[i:i+k]) for i in range(len(words) - k + 1)}


def _make_minhash(shingle_set, num_perm=MINHASH_NUM_PERM):
    m = MinHash(num_perm=num_perm)
    for s in shingle_set:
        m.update(s.encode("utf-8"))
    return m


def build_lsh_index(texts, comment_ids, threshold=0.7, num_perm=MINHASH_NUM_PERM):
    print(f"  Building MinHash LSH index ({len(texts)} docs, threshold={threshold})")
    lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
    minhashes = {}
    for cid, text in zip(comment_ids, texts):
        m = _make_minhash(_shingles(text), num_perm)
        minhashes[cid] = m
        try:
            lsh.insert(cid, m)
        except ValueError:
            pass  # duplicate key
    return lsh, minhashes


def find_duplicate_groups(lsh, minhashes, comment_ids):
    # Union-Find
    parent = {cid: cid for cid in comment_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for cid in comment_ids:
        matches = lsh.query(minhashes[cid])
        for m in matches:
            if m != cid:
                union(cid, m)

    # Collect groups
    groups = {}
    for cid in comment_ids:
        root = find(cid)
        groups.setdefault(root, set()).add(cid)

    # Only return groups with 2+ members
    dup_groups = [g for g in groups.values() if len(g) > 1]
    total_duped = sum(len(g) for g in dup_groups)
    print(f"  Found {len(dup_groups)} duplicate groups ({total_duped} comments involved)")
    return dup_groups


def compute_duplicate_stats(dup_groups, labels, comment_ids):
    # Map comment_id -> cluster label
    id_to_label = dict(zip(comment_ids, labels))
    id_in_dup = set()
    for g in dup_groups:
        id_in_dup.update(g)

    stats = {}
    cluster_ids = set(labels)
    for cl in cluster_ids:
        if cl == -1:
            continue
        members = [cid for cid, l in zip(comment_ids, labels) if l == cl]
        n_dup = sum(1 for cid in members if cid in id_in_dup)
        # Largest dup group within this cluster
        max_group = 0
        for g in dup_groups:
            overlap = sum(1 for cid in g if id_to_label.get(cid) == cl)
            max_group = max(max_group, overlap)
        stats[int(cl)] = {
            "n_members": len(members),
            "n_duplicates": n_dup,
            "dup_fraction": n_dup / max(1, len(members)),
            "largest_dup_group": max_group,
        }
    return stats
