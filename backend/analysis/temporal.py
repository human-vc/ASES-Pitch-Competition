"""
Temporal-argument coupling detection via Kulldorff (1997) temporal scan statistic.

Per-cluster output:
- lambda_star: Kulldorff log-likelihood ratio (test statistic)
- p_analytic: tail bound from chi-squared asymptotic
- peak_window: (start, end) of the maximum-likelihood window
- peak_count: cluster comments in the window
- peak_expected: expected count under H0 (docket-conditional Poisson)
- tcs: temporal coupling score in [0, 1)
"""

import math
import numpy as np
import pandas as pd
from scipy.stats import chi2 as chi2_dist


def _to_unix(timestamps):
    """Parse iso8601 timestamps to unix seconds (float)."""
    dt = pd.to_datetime(timestamps, errors="coerce", utc=True)
    return dt.astype("int64").to_numpy() / 1e9  # ns -> s


def kulldorff_scan(cluster_times, docket_times, max_window_frac=0.5):
    """
    Compute Kulldorff temporal scan statistic for one cluster.

    Returns dict with: lambda_star, p_analytic, peak_start, peak_end,
    peak_count, peak_expected, window_seconds, tcs.
    """
    cluster = np.sort(np.asarray(cluster_times, dtype=float))
    docket = np.sort(np.asarray(docket_times, dtype=float))
    cluster = cluster[~np.isnan(cluster)]
    docket = docket[~np.isnan(docket)]

    N, M = cluster.size, docket.size
    if N < 3 or M < N:
        return None

    T0, T1 = docket[0], docket[-1]
    max_win = max_window_frac * (T1 - T0)

    # For each candidate window [cluster[i], cluster[j]], compute LRT
    left = np.searchsorted(docket, cluster, side="left")
    right = np.searchsorted(docket, cluster, side="right")

    best_lam = 0.0
    best_i, best_j, best_n, best_mu = 0, 0, 0, 0.0

    for i in range(N):
        cap = np.searchsorted(cluster, cluster[i] + max_win, side="right") - 1
        if cap < i:
            continue
        j_rng = np.arange(i, cap + 1)
        n_W = (j_rng - i + 1).astype(float)
        d_W = (right[j_rng] - left[i]).astype(float)
        mu_W = N * d_W / M

        valid = (n_W > mu_W) & (n_W < N) & (mu_W > 0) & (mu_W < N)
        if not valid.any():
            continue

        nW, muW = n_W[valid], mu_W[valid]
        with np.errstate(divide="ignore", invalid="ignore"):
            lam = nW * np.log(nW / muW) + (N - nW) * np.log((N - nW) / (N - muW))
        lam[~np.isfinite(lam)] = 0

        k = int(np.argmax(lam))
        if lam[k] > best_lam:
            jj = j_rng[valid][k]
            best_lam = float(lam[k])
            best_i, best_j = i, int(jj)
            best_n = int(nW[k])
            best_mu = float(muW[k])

    # Analytical p-value (chi-squared asymptotic)
    p_analytic = float(0.5 * chi2_dist.sf(2 * best_lam, df=1))

    # Temporal coupling score
    tcs = float(1.0 - math.exp(-best_lam / max(N, 1)))

    return {
        "lambda_star": best_lam,
        "p_analytic": p_analytic,
        "peak_start": float(cluster[best_i]),
        "peak_end": float(cluster[best_j]),
        "peak_count": best_n,
        "peak_expected": best_mu,
        "window_seconds": float(cluster[best_j] - cluster[best_i]),
        "tcs": tcs,
    }


def cluster_temporal_scores(posted_dates, labels, comment_ids, min_cluster_size=10):
    """
    Run Kulldorff scan per cluster.
    Returns dict[cluster_id -> stats].
    """
    docket_times = _to_unix(posted_dates)

    results = {}
    cluster_ids = sorted(set(labels.tolist())) if hasattr(labels, "tolist") else sorted(set(labels))

    for cl in cluster_ids:
        if cl == -1:
            continue
        mask = (labels == cl) if hasattr(labels, "__getitem__") else np.array([l == cl for l in labels])
        cluster_idx = np.where(mask)[0]
        if len(cluster_idx) < min_cluster_size:
            continue

        cluster_t = docket_times[cluster_idx]
        scan = kulldorff_scan(cluster_t, docket_times)
        if scan is None:
            continue

        # Pretty-format peak window
        peak_start_iso = pd.Timestamp(scan["peak_start"], unit="s", tz="UTC").isoformat()
        peak_end_iso = pd.Timestamp(scan["peak_end"], unit="s", tz="UTC").isoformat()
        window_min = scan["window_seconds"] / 60.0

        results[int(cl)] = {
            "lambda_star": round(scan["lambda_star"], 4),
            "p_analytic": scan["p_analytic"],
            "peak_count": scan["peak_count"],
            "peak_expected": round(scan["peak_expected"], 2),
            "peak_start": peak_start_iso,
            "peak_end": peak_end_iso,
            "window_minutes": round(window_min, 2),
            "tcs": round(scan["tcs"], 4),
        }

    return results


def build_timeline(posted_dates, window_hours=1):
    """Build a histogram of submission counts per time window for visualization."""
    dt = pd.to_datetime(posted_dates, errors="coerce", utc=True)
    dt = dt.dropna()
    if dt.empty:
        return []

    rate = dt.value_counts().resample(f"{window_hours}h").sum().sort_index().fillna(0)

    if len(rate) < 3:
        return [{"timestamp": ts.isoformat(), "count": int(c), "is_burst": False}
                for ts, c in rate.items()]

    mean = rate.mean()
    std = rate.std()
    timeline = []
    for ts, count in rate.items():
        zscore = (count - mean) / std if std > 0 else 0
        timeline.append({
            "timestamp": ts.isoformat(),
            "count": int(count),
            "is_burst": zscore > 3.0,
        })
    return timeline
