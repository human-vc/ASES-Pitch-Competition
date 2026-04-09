import numpy as np
from config import (
    W_DUPLICATE, W_BURST, W_STYLE, W_COMPRESS, W_FINGERPRINT, W_AI, W_PROBE,
    CAMPAIGN_THRESHOLD,
)
from ingestion.db import get_comments, store_analysis_run, store_fingerprint
from analysis.embedding import embed_comments
from analysis.clustering import run_clustering
from analysis.duplicates import build_lsh_index, find_duplicate_groups, compute_duplicate_stats
from analysis.temporal import cluster_temporal_scores, build_timeline
from analysis.stylometrics import compute_docket_matrix, cluster_campaign_scores
from analysis.geographic import cluster_geographic_concentration
from analysis.entities import resolve_entities, cluster_entity_concentration
from analysis.duplicate_chain import build_duplicate_chain
from analysis.argument_identity import extract_arguments, cluster_argument_identity
from analysis.coordination import detect_communities, coordination_vs_semantic_overlap
from analysis.ai_detection import cluster_ai_detection
from analysis.paraphrase_probe import probe_top_clusters


def score_cluster(cl_id, dup_stats, temporal_stats, style_stats, arg_stats, ai_stats, probe_stats):
    """Combine signals into composite score in [0, 1]."""
    score = 0.0
    breakdown = {}

    dup_frac = dup_stats.get(cl_id, {}).get("dup_fraction", 0)
    score += W_DUPLICATE * dup_frac
    breakdown["duplicate"] = round(dup_frac, 3)

    tcs = temporal_stats.get(cl_id, {}).get("tcs", 0)
    score += W_BURST * tcs
    breakdown["temporal_coupling"] = round(tcs, 3)

    style_score = style_stats.get(cl_id, {}).get("campaign_score", 0)
    score += (W_STYLE + W_COMPRESS) * style_score
    breakdown["stylometric"] = round(style_score, 3)

    arg_id = arg_stats.get(cl_id, {}).get("mean_identity", 0) if arg_stats else 0
    score += W_FINGERPRINT * arg_id
    breakdown["argument_identity"] = round(arg_id, 3)

    ai_score = ai_stats.get(cl_id, {}).get("ai_score", 0) if ai_stats else 0
    score += W_AI * ai_score
    breakdown["ai_detection"] = round(ai_score, 3)

    probe_reach = probe_stats.get(cl_id, {}).get("reachability_score", 0) if probe_stats else 0
    score += W_PROBE * probe_reach
    breakdown["paraphrase_reachable"] = round(probe_reach, 3)

    return round(min(1.0, score), 3), breakdown


def classify_cluster(score):
    if score >= CAMPAIGN_THRESHOLD:
        return "campaign"
    elif score >= CAMPAIGN_THRESHOLD * 0.7:
        return "uncertain"
    return "organic"


def run_full_analysis(conn, docket_id, encoder=None, skip_fingerprint=False,
                     skip_ai_detection=False, skip_paraphrase_probe=False):
    print(f"\n{'='*60}")
    print(f"  ANALYZING: {docket_id}")
    print(f"{'='*60}")

    # 1. Load comments
    comments = get_comments(conn, docket_id)
    texts = [c["text"] for c in comments]
    comment_ids = [c["id"] for c in comments]
    posted_dates = [c["posted_date"] for c in comments]
    print(f"  {len(comments)} comments with text")

    if len(comments) < 30:
        print("  Too few comments for meaningful analysis")
        return None

    # 2. Embeddings
    ids, embeddings = embed_comments(conn, docket_id, encoder)
    id_set = set(ids)
    aligned = [(c, t, pd) for c, t, pd in zip(comment_ids, texts, posted_dates) if c in id_set]
    aligned_comments = [comments[i] for i, c in enumerate(comments) if c["id"] in id_set]
    comment_ids = [a[0] for a in aligned]
    texts = [a[1] for a in aligned]
    posted_dates = [a[2] for a in aligned]
    id_to_idx = {cid: i for i, cid in enumerate(ids)}
    embeddings = np.array([embeddings[id_to_idx[cid]] for cid in comment_ids])

    # 3. Clustering
    print(f"\n  --- Clustering (densMAP + leaf HDBSCAN + soft membership) ---")
    cluster_result = run_clustering(embeddings)
    labels = cluster_result["labels"]
    coords_2d = cluster_result["coords_2d"]

    # 4. Near-duplicate detection
    print(f"\n  --- Duplicate Detection (MinHash LSH) ---")
    lsh, minhashes = build_lsh_index(texts, comment_ids)
    dup_groups = find_duplicate_groups(lsh, minhashes, comment_ids)
    dup_stats = compute_duplicate_stats(dup_groups, labels, comment_ids)

    # 5. Duplicate chain analysis
    print(f"\n  --- Duplicate Chain Gradient ---")
    dup_chain_stats = build_duplicate_chain(texts, embeddings, comment_ids, labels, dup_groups)

    # 6. Stylometric campaign scoring
    print(f"\n  --- Stylometric Analysis (19 features + GVR) ---")
    style_X, fw_baseline = compute_docket_matrix(texts)
    style_stats = cluster_campaign_scores(style_X, labels)

    # 7. Temporal coupling
    print(f"\n  --- Temporal Coupling (Kulldorff scan) ---")
    temporal_stats = cluster_temporal_scores(posted_dates, labels, comment_ids)
    timeline = build_timeline(posted_dates)

    # 8. Geographic concentration
    print(f"\n  --- Geographic Concentration ---")
    geo_stats = cluster_geographic_concentration(aligned_comments, labels)

    # 9. Entity resolution
    print(f"\n  --- Entity Resolution ---")
    entity_matches = resolve_entities(aligned_comments)
    print(f"  Matched {len(entity_matches)} comments to known entities")
    entity_stats = cluster_entity_concentration(aligned_comments, labels, entity_matches)

    # 10. Argument identity (Claude Haiku, optional)
    arg_stats = {}
    arguments = {}
    if not skip_fingerprint:
        print(f"\n  --- Argument Identity (Claude API) ---")
        arguments = extract_arguments(texts, comment_ids, labels)
        arg_stats = cluster_argument_identity(arguments, labels, comment_ids)

    # 11. Coordination network (Leiden)
    print(f"\n  --- Coordination Network (Leiden) ---")
    comm_membership, communities = detect_communities(aligned_comments, dup_groups, comment_ids)
    coord_overlap = coordination_vs_semantic_overlap(communities, labels) if communities else []

    # 12. DivEye AI detection (cluster-aggregated)
    ai_stats = {}
    if not skip_ai_detection:
        print(f"\n  --- AI Detection (DivEye-style surprisal) ---")
        ai_stats = cluster_ai_detection(texts, labels)

    # 13. Counterfactual paraphrase probing
    probe_stats = {}
    if not skip_paraphrase_probe and not skip_fingerprint:
        print(f"\n  --- Counterfactual Paraphrase Probing ---")
        probe_stats = probe_top_clusters(aligned_comments, embeddings, texts, comment_ids, labels, top_n=3)

    # 14. Composite scoring
    print(f"\n  --- Campaign Scoring ---")
    cluster_results = []
    n_campaigns = 0
    n_manufactured = 0

    for cl in sorted(set(labels.tolist())):
        if cl == -1:
            continue
        members = [(i, cid) for i, (cid, l) in enumerate(zip(comment_ids, labels)) if l == cl]
        n_members = len(members)
        if n_members < 3:
            continue

        score, breakdown = score_cluster(int(cl), dup_stats, temporal_stats, style_stats, arg_stats, ai_stats, probe_stats)
        classification = classify_cluster(score)

        if classification == "campaign":
            n_campaigns += 1
            n_manufactured += n_members

        member_indices = [m[0] for m in members]
        cx = float(np.mean(coords_2d[member_indices, 0]))
        cy = float(np.mean(coords_2d[member_indices, 1]))
        spread = float(np.std(coords_2d[member_indices]))

        sample_texts = [texts[members[i][0]][:200] for i in range(min(5, len(members)))]

        is_campaign_label = cl >= 10000

        cl_info = {
            "cluster_id": int(cl),
            "n_comments": n_members,
            "is_tree_campaign": is_campaign_label,
            "classification": classification,
            "campaign_score": score,
            "score_breakdown": breakdown,
            "center_x": round(cx, 4),
            "center_y": round(cy, 4),
            "radius": round(spread, 4),
            "sample_comments": sample_texts,
            "stylometric": style_stats.get(int(cl), {}),
            "temporal": temporal_stats.get(int(cl), {}),
            "duplicates": dup_stats.get(int(cl), {}),
            "duplicate_chain": dup_chain_stats.get(int(cl), {}),
            "geographic": geo_stats.get(int(cl), {}),
            "entities": entity_stats.get(int(cl), {}),
            "argument_identity": arg_stats.get(int(cl), {}),
            "ai_detection": ai_stats.get(int(cl), {}),
            "paraphrase_probe": probe_stats.get(int(cl), {}),
        }
        cluster_results.append(cl_info)

        # Store fingerprint for cross-docket matching
        arg_data = arg_stats.get(int(cl), {})
        if arg_data and arg_data.get("argument_hash"):
            try:
                store_fingerprint(conn, docket_id, int(cl), {
                    "n_comments": n_members,
                    "position": arg_data.get("dominant_position"),
                    "stance_summary": arg_data.get("stance_summary"),
                    "claims": arg_data.get("top_premises", []),
                    "argument_hash": arg_data.get("argument_hash"),
                    "campaign_score": score,
                })
            except Exception as e:
                print(f"    [warn] failed to store fingerprint: {e}")

        tcs = temporal_stats.get(int(cl), {}).get("tcs", 0)
        ss = style_stats.get(int(cl), {}).get("campaign_score", 0)
        df = dup_stats.get(int(cl), {}).get("dup_fraction", 0)
        ai = ai_stats.get(int(cl), {}).get("ai_score", 0)
        ai_id = arg_stats.get(int(cl), {}).get("mean_identity", 0)
        tag = "CAMPAIGN" if classification == "campaign" else classification.upper()
        print(f"    Cluster {cl}: n={n_members:5} score={score:.3f} "
              f"tcs={tcs:.2f} style={ss:.2f} dup={df:.2f} arg={ai_id:.2f} ai={ai:.2f} [{tag}]")

    n_unique = len(comment_ids) - n_manufactured - cluster_result["noise_count"]

    result = {
        "docket_id": docket_id,
        "n_comments": len(comment_ids),
        "n_clusters": cluster_result["n_clusters"],
        "n_campaigns": n_campaigns,
        "n_manufactured": n_manufactured,
        "n_unique_voices": max(0, n_unique),
        "manufactured_pct": round(n_manufactured / max(1, len(comment_ids)) * 100, 1),
        "validity": cluster_result["validity"],
        "clusters": cluster_results,
        "timeline": timeline,
        "communities": communities,
        "coordination_overlap": coord_overlap,
        "coords_2d": coords_2d.tolist(),
        "comment_ids": comment_ids,
        "labels": labels.tolist(),
    }

    store_analysis_run(conn, {
        "docket_id": docket_id,
        "n_comments": len(comment_ids),
        "n_clusters": cluster_result["n_clusters"],
        "n_campaigns": n_campaigns,
        "results": result,
    })

    print(f"\n{'='*60}")
    print(f"  RESULTS: {docket_id}")
    print(f"  Comments:           {len(comment_ids)}")
    print(f"  Semantic clusters:  {cluster_result['n_clusters']}")
    print(f"  Coord communities:  {len(communities)}")
    print(f"  Campaigns detected: {n_campaigns}")
    print(f"  Manufactured:       {n_manufactured} ({result['manufactured_pct']}%)")
    print(f"  Unique voices:      {n_unique}")
    print(f"  HDBSCAN validity:   {cluster_result['validity']:.3f}")
    print(f"{'='*60}\n")

    return result
