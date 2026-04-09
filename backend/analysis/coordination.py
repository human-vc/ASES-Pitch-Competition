"""
Coordination network detection — distinct from semantic clustering.

A semantic cluster says "what people are saying."
A coordination community says "who is acting together."

These are different. A single AI campaign can produce multiple semantic clusters
(paraphrased into sub-arguments). A single semantic cluster can contain multiple
unrelated organic voices.

We build a comment-comment graph with multiple edge types:
  - co_timing: Δt < TIMING_WINDOW (default 60s)
  - co_template: MinHash Jaccard > TEMPLATE_THRESHOLD
  - co_metadata: shared name pattern + ZIP / org

Then run Leiden community detection on the weighted union.
"""

import time
from collections import defaultdict
from datetime import datetime
import numpy as np

try:
    import igraph as ig
    import leidenalg
    IGRAPH_OK = True
except ImportError:
    IGRAPH_OK = False


TIMING_WINDOW_SECONDS = 60
TEMPLATE_THRESHOLD = 0.7
W_TIMING = 0.4
W_TEMPLATE = 0.4
W_METADATA = 0.2


def _to_unix(ts_str):
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def build_coordination_edges(comments, dup_groups, comment_ids):
    """
    Build edges with three signal types: timing, template, metadata.
    Returns list of (i, j, weight, edge_types) tuples.
    """
    n = len(comments)
    edges = defaultdict(lambda: {"weight": 0.0, "types": set()})

    # 1. Co-timing edges (sliding window)
    timestamps = []
    for c in comments:
        ts = _to_unix(c.get("posted_date"))
        timestamps.append(ts if ts is not None else -1)

    sorted_idx = sorted(range(n), key=lambda i: timestamps[i])
    j = 0
    for ki, i in enumerate(sorted_idx):
        if timestamps[i] < 0:
            continue
        # Find all j > i where t_j - t_i <= window
        for kj in range(ki + 1, len(sorted_idx)):
            j_idx = sorted_idx[kj]
            if timestamps[j_idx] < 0:
                continue
            if timestamps[j_idx] - timestamps[i] > TIMING_WINDOW_SECONDS:
                break
            key = (min(i, j_idx), max(i, j_idx))
            edges[key]["weight"] += W_TIMING
            edges[key]["types"].add("timing")

    # 2. Co-template edges (from MinHash dup groups)
    id_to_idx = {cid: i for i, cid in enumerate(comment_ids)}
    for group in dup_groups:
        members = [id_to_idx[cid] for cid in group if cid in id_to_idx]
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                key = (min(members[i], members[j]), max(members[i], members[j]))
                edges[key]["weight"] += W_TEMPLATE
                edges[key]["types"].add("template")

    # 3. Co-metadata edges (shared org or shared first+state)
    org_groups = defaultdict(list)
    name_state_groups = defaultdict(list)
    for i, c in enumerate(comments):
        org = (c.get("organization") or "").strip().lower()
        if org:
            org_groups[org].append(i)
        first = (c.get("submitter_first") or "").strip().lower()
        state = (c.get("state_prov") or "").strip().upper()
        if first and state:
            name_state_groups[(first[:3], state)].append(i)

    for group in list(org_groups.values()) + list(name_state_groups.values()):
        if len(group) < 2 or len(group) > 50:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                key = (group[i], group[j])
                edges[key]["weight"] += W_METADATA / max(1, len(group) - 1)
                edges[key]["types"].add("metadata")

    return [(k[0], k[1], v["weight"], list(v["types"])) for k, v in edges.items() if v["weight"] > 0.1]


def detect_communities(comments, dup_groups, comment_ids, resolution=1.0):
    """
    Build coordination network and run Leiden community detection.
    Returns dict[comment_idx -> community_id] and community stats.
    """
    if not IGRAPH_OK:
        print("  [skip] igraph/leidenalg not installed")
        return None, []

    n = len(comments)
    print(f"  Building coordination edges ({n} nodes)...")
    t0 = time.time()
    edges = build_coordination_edges(comments, dup_groups, comment_ids)
    print(f"  Built {len(edges)} coordination edges in {time.time()-t0:.1f}s")

    if not edges:
        return {}, []

    g = ig.Graph(n=n, directed=False)
    g.add_edges([(e[0], e[1]) for e in edges])
    g.es["weight"] = [e[2] for e in edges]

    print(f"  Running Leiden community detection...")
    partition = leidenalg.find_partition(
        g,
        leidenalg.RBConfigurationVertexPartition,
        weights="weight",
        resolution_parameter=resolution,
        seed=42,
    )

    # Filter to communities with at least 3 members
    communities = []
    membership = {}
    for ci, comm in enumerate(partition):
        if len(comm) < 3:
            continue
        comm_id = len(communities)
        for node in comm:
            membership[node] = comm_id

        # Aggregate stats
        edge_types = set()
        edge_weight_sum = 0.0
        comm_set = set(comm)
        for e in edges:
            if e[0] in comm_set and e[1] in comm_set:
                edge_types.update(e[3])
                edge_weight_sum += e[2]

        communities.append({
            "community_id": comm_id,
            "n_members": len(comm),
            "members": list(comm),
            "edge_types": list(edge_types),
            "internal_weight": round(edge_weight_sum, 3),
            "density": round(2 * edge_weight_sum / max(1, len(comm) * (len(comm) - 1)), 4),
        })

    print(f"  Found {len(communities)} coordination communities ({len(membership)} members)")
    return membership, communities


def coordination_vs_semantic_overlap(communities, semantic_labels):
    """
    Compute the overlap between coordination communities and semantic clusters.
    A perfect match (overlap=1) means coordination = semantics.
    Low overlap means coordination is independent signal.
    """
    overlaps = []
    for comm in communities:
        members = comm["members"]
        if not members:
            continue
        sem_labels_in_comm = [semantic_labels[m] for m in members if semantic_labels[m] != -1]
        if not sem_labels_in_comm:
            continue
        from collections import Counter
        cnt = Counter(sem_labels_in_comm)
        top_label, top_count = cnt.most_common(1)[0]
        overlap = top_count / len(members)
        overlaps.append({
            "community_id": comm["community_id"],
            "n_members": len(members),
            "best_semantic_match": int(top_label),
            "overlap": round(overlap, 3),
        })
    return overlaps
