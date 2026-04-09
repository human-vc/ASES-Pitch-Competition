import warnings
import numpy as np
import umap
import hdbscan
from collections import defaultdict
from config import (
    UMAP_N_NEIGHBORS, UMAP_N_COMPONENTS, UMAP_MIN_DIST,
    UMAP_METRIC, UMAP_DENSMAP, UMAP_DENS_LAMBDA,
    HDBSCAN_MIN_CLUSTER, HDBSCAN_MIN_SAMPLES, HDBSCAN_SELECTION,
    CAMPAIGN_MIN_SIZE, ENABLE_TREE_WALK, SEED,
)

warnings.filterwarnings("ignore", category=UserWarning, module="umap")


def reduce_dims(embeddings, n_components=UMAP_N_COMPONENTS):
    """densMAP reduction — preserves density structure for variable-size clusters."""
    n_neighbors = min(UMAP_N_NEIGHBORS, embeddings.shape[0] - 1)
    label = "densMAP" if UMAP_DENSMAP else "UMAP"
    print(f"  {label}: {embeddings.shape[1]}d -> {n_components}d ({embeddings.shape[0]} points)")
    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        n_components=n_components,
        min_dist=UMAP_MIN_DIST,
        metric=UMAP_METRIC,
        densmap=UMAP_DENSMAP,
        dens_lambda=UMAP_DENS_LAMBDA if UMAP_DENSMAP else None,
        random_state=SEED,
    )
    return reducer.fit_transform(embeddings)


def project_2d(embeddings):
    """Separate 2D projection for visualization (densmap optional here)."""
    n_neighbors = min(UMAP_N_NEIGHBORS, embeddings.shape[0] - 1)
    print(f"  UMAP-2D: visualization projection")
    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        n_components=2,
        min_dist=0.1,
        metric=UMAP_METRIC,
        random_state=SEED,
    )
    return reducer.fit_transform(embeddings)


def cluster_leaf(reduced):
    """HDBSCAN with leaf extraction — catches small organic clusters.
    Auto-scales min_cluster_size with dataset size."""
    n = reduced.shape[0]
    # Scale: ~sqrt(n)/3 — favor more fine-grained clusters with high purity
    auto_min = max(HDBSCAN_MIN_CLUSTER, int(np.sqrt(n) / 3))
    auto_samples = max(HDBSCAN_MIN_SAMPLES, auto_min // 4)
    print(f"  HDBSCAN[{HDBSCAN_SELECTION}]: min_cluster={auto_min}, min_samples={auto_samples} (auto for n={n})")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=auto_min,
        min_samples=auto_samples,
        cluster_selection_method=HDBSCAN_SELECTION,
        metric="euclidean",
        prediction_data=True,
        gen_min_span_tree=True,    # required for relative_validity_ (DBCV)
        core_dist_n_jobs=-1,
    )
    clusterer.fit(reduced)
    return clusterer


def walk_tree_for_campaigns(clusterer, min_size=CAMPAIGN_MIN_SIZE):
    """
    Walk the condensed tree to find 'campaign' nodes — internal nodes whose
    subtree contains >= min_size leaves. Relabel those points with a campaign label.
    Returns final_labels (numpy array).
    """
    tree_df = clusterer.condensed_tree_.to_pandas()
    leaf_labels = clusterer.labels_.copy()
    n_points = len(leaf_labels)

    # Build parent → list of (child, child_size)
    children_map = defaultdict(list)
    for _, row in tree_df.iterrows():
        children_map[int(row["parent"])].append((int(row["child"]), int(row["child_size"])))

    def descendants_pts(node):
        """Get all leaf point indices under an internal node."""
        stack = [node]
        pts = []
        while stack:
            n = stack.pop()
            kids = children_map.get(n, [])
            for child, size in kids:
                if size == 1:
                    if child < n_points:
                        pts.append(child)
                else:
                    stack.append(child)
        return pts

    # Find campaign-sized internal nodes (largest first to avoid double-relabel)
    internal_nodes = [(int(row["child"]), int(row["child_size"]))
                      for _, row in tree_df.iterrows() if int(row["child_size"]) >= min_size]
    internal_nodes.sort(key=lambda x: -x[1])

    final_labels = leaf_labels.copy()
    campaign_id = 10000
    seen = set()
    for node, size in internal_nodes:
        pts = [p for p in descendants_pts(node) if p not in seen]
        if len(pts) >= min_size:
            for p in pts:
                final_labels[p] = campaign_id
                seen.add(p)
            campaign_id += 1

    return final_labels


def reclaim_noise(clusterer, soft, labels, threshold=0.5):
    """Use soft membership to reclaim high-confidence noise points."""
    if soft is None:
        return labels
    new_labels = labels.copy()
    noise_mask = new_labels == -1
    if noise_mask.sum() == 0:
        return new_labels
    confidence = soft.max(axis=1)
    primary = soft.argmax(axis=1)
    reclaim = noise_mask & (confidence > threshold)
    n_reclaimed = int(reclaim.sum())
    if n_reclaimed > 0:
        # Map soft cluster idx → original HDBSCAN labels
        cluster_id_map = sorted(set(clusterer.labels_) - {-1})
        for i in np.where(reclaim)[0]:
            new_labels[i] = cluster_id_map[primary[i]]
        print(f"  Reclaimed {n_reclaimed} noise points via soft membership")
    return new_labels


def run_clustering(embeddings):
    n = embeddings.shape[0]
    if n < 30:
        print(f"  Too few points ({n}), skipping clustering")
        return {
            "labels": np.full(n, -1),
            "soft_membership": None,
            "coords_2d": np.zeros((n, 2)),
            "n_clusters": 0,
            "n_campaigns": 0,
            "noise_count": n,
            "validity": 0.0,
        }

    # 1. Reduce
    reduced = reduce_dims(embeddings)

    # 2. Cluster (leaf mode for small clusters)
    clusterer = cluster_leaf(reduced)
    leaf_labels = clusterer.labels_

    # 3. Soft membership (only if reasonable size)
    soft = None
    if n < 30000:
        try:
            soft = hdbscan.all_points_membership_vectors(clusterer)
        except Exception as e:
            print(f"  [warn] soft membership failed: {e}")

    # 4. Reclaim noise via soft membership
    final_labels = reclaim_noise(clusterer, soft, leaf_labels)

    # 5. (Optional) Walk tree for campaign labels — only at scale
    if ENABLE_TREE_WALK and n > 1000:
        tree_labels = walk_tree_for_campaigns(clusterer)
        # Tree-walk overlays campaign labels on top of leaf clusters
        for i in range(n):
            if tree_labels[i] >= 10000:
                final_labels[i] = tree_labels[i]

    # 6. 2D projection for viz
    coords_2d = project_2d(embeddings)

    n_clusters = len(set(final_labels)) - (1 if -1 in final_labels else 0)
    n_campaigns = len([l for l in set(final_labels) if l >= 10000])
    n_noise = int((final_labels == -1).sum())

    try:
        validity = float(clusterer.relative_validity_)
    except Exception:
        validity = 0.0

    print(f"  Found {n_clusters} clusters ({n_campaigns} campaign-sized, {n_noise} noise)")
    print(f"  HDBSCAN relative validity (DBCV approx): {validity:.3f}")

    return {
        "labels": final_labels,
        "soft_membership": soft,
        "coords_2d": coords_2d,
        "n_clusters": n_clusters,
        "n_campaigns": n_campaigns,
        "noise_count": n_noise,
        "validity": validity,
    }
