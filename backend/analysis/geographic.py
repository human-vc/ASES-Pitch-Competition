"""
Geographic concentration analysis.

For each cluster, computes whether comment origins are anomalously concentrated
geographically vs the docket-wide distribution. High concentration with low data
completeness gets flagged with low confidence.
"""

import math
from collections import Counter
import numpy as np


def _location_key(comment):
    """Returns canonical location string or None."""
    state = (comment.get("state_prov") or "").strip().upper()
    city = (comment.get("city") or "").strip().lower()
    if state and city:
        return f"{city}, {state}"
    if state:
        return state
    return None


def _shannon_entropy(counts):
    total = sum(counts)
    if total == 0:
        return 0.0
    return -sum((c / total) * math.log2(c / total) for c in counts if c > 0)


def compute_docket_geo_distribution(comments):
    """Returns (state_dist, completeness) for the full docket."""
    state_counts = Counter()
    n_with_loc = 0
    for c in comments:
        state = (c.get("state_prov") or "").strip().upper()
        if state:
            state_counts[state] += 1
            n_with_loc += 1
    completeness = n_with_loc / max(1, len(comments))
    return state_counts, completeness


def cluster_geographic_concentration(comments, labels):
    """
    For each cluster, compute geographic concentration metrics.
    Returns dict[cluster_id -> stats].
    """
    docket_states, docket_completeness = compute_docket_geo_distribution(comments)
    docket_total_with_loc = sum(docket_states.values())
    docket_distribution = {s: c / docket_total_with_loc
                            for s, c in docket_states.items()} if docket_total_with_loc else {}

    results = {}
    for cl in set(labels.tolist()) if hasattr(labels, "tolist") else set(labels):
        if cl == -1:
            continue
        member_idx = [i for i, l in enumerate(labels) if l == cl]
        if len(member_idx) < 3:
            continue

        members = [comments[i] for i in member_idx]
        n_total = len(members)

        # Count states
        state_counts = Counter()
        n_with_state = 0
        for m in members:
            state = (m.get("state_prov") or "").strip().upper()
            if state:
                state_counts[state] += 1
                n_with_state += 1

        completeness = n_with_state / n_total

        if n_with_state < 3:
            results[int(cl)] = {
                "completeness": round(completeness, 3),
                "n_states": 0,
                "top_state": None,
                "top_state_pct": 0.0,
                "concentration_score": 0.0,
                "entropy_ratio": None,
                "confidence": "low",
                "note": "insufficient location data",
            }
            continue

        # Top state
        top_state, top_count = state_counts.most_common(1)[0]
        top_pct = top_count / n_with_state

        # Geographic entropy vs docket entropy (lower entropy = more concentrated)
        cluster_dist_counts = list(state_counts.values())
        cluster_entropy = _shannon_entropy(cluster_dist_counts)
        docket_entropy = _shannon_entropy(list(docket_states.values()))

        entropy_ratio = (cluster_entropy / docket_entropy) if docket_entropy > 0 else 1.0

        # KL divergence: how surprising is the cluster's distribution given docket?
        kl = 0.0
        for state, count in state_counts.items():
            p = count / n_with_state
            q = docket_distribution.get(state, 1e-9)
            kl += p * math.log2(p / q)

        # Concentration score: how much MORE concentrated than docket
        concentration_score = float(np.clip(1.0 - entropy_ratio, 0.0, 1.0))

        # Confidence based on completeness
        if completeness >= 0.7:
            confidence = "high"
        elif completeness >= 0.4:
            confidence = "medium"
        else:
            confidence = "low"

        results[int(cl)] = {
            "completeness": round(completeness, 3),
            "n_states": len(state_counts),
            "top_state": top_state,
            "top_state_pct": round(top_pct, 3),
            "concentration_score": round(concentration_score, 4),
            "entropy_ratio": round(entropy_ratio, 4),
            "kl_divergence": round(kl, 4),
            "confidence": confidence,
            "state_distribution": dict(state_counts.most_common(5)),
        }
    return results
