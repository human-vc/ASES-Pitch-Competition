"""
DivEye-style AI text detection (cluster-aggregated).

The 2026 insight: stop trying to classify INDIVIDUAL comments as AI-generated.
That game is lost — paraphrased outputs from Claude/GPT-5 defeat all per-comment
detectors. Instead: aggregate weak per-comment signals at the CLUSTER level.

A cluster where every comment has the same surprisal-variance signature is
overwhelming evidence of coordinated AI generation, even if no individual
comment is conclusively flagged.

Implementation: lightweight surprisal-based features using GPT-2 small (124M).
On CPU this is ~50-200ms per comment. For demo speed we sample per cluster.
"""

import math
import numpy as np
from collections import Counter

# Lazy import — only load GPT-2 if we actually use it
_GPT2_MODEL = None
_GPT2_TOKENIZER = None


def _load_gpt2():
    global _GPT2_MODEL, _GPT2_TOKENIZER
    if _GPT2_MODEL is None:
        try:
            import torch
            from transformers import GPT2LMHeadModel, GPT2TokenizerFast
            _GPT2_TOKENIZER = GPT2TokenizerFast.from_pretrained("gpt2")
            _GPT2_MODEL = GPT2LMHeadModel.from_pretrained("gpt2")
            _GPT2_MODEL.eval()
            print(f"  Loaded GPT-2 small (124M) for surprisal scoring")
        except Exception as e:
            print(f"  [warn] Could not load GPT-2: {e}")
            return None, None
    return _GPT2_MODEL, _GPT2_TOKENIZER


def compute_surprisal_features(text, model, tokenizer, max_tokens=256):
    """
    Compute 9 DivEye-style features from token-level surprisal:
      1-4: mean, var, skew, kurt of surprisal
      5-6: mean, var of first difference
      7-9: var, entropy, autocorr of second difference
    """
    if not text or not model or not tokenizer:
        return np.zeros(9, dtype=float)

    import torch
    try:
        ids = tokenizer.encode(text, return_tensors="pt", max_length=max_tokens, truncation=True)
        if ids.shape[1] < 5:
            return np.zeros(9, dtype=float)

        with torch.no_grad():
            out = model(ids, labels=ids)
            logits = out.logits[0]  # [seq_len, vocab]
            log_probs = torch.log_softmax(logits, dim=-1)

        # Surprisal at each position (excluding first)
        target_ids = ids[0, 1:]
        surprisal = -log_probs[:-1].gather(1, target_ids.unsqueeze(1)).squeeze().numpy()

        if len(surprisal) < 4:
            return np.zeros(9, dtype=float)

        # First and second differences
        d1 = np.diff(surprisal)
        d2 = np.diff(d1)

        # Stats
        s_mean = float(surprisal.mean())
        s_var = float(surprisal.var())
        s_skew = float(((surprisal - s_mean) ** 3).mean() / (s_var ** 1.5 + 1e-9))
        s_kurt = float(((surprisal - s_mean) ** 4).mean() / (s_var ** 2 + 1e-9))

        d1_mean = float(d1.mean())
        d1_var = float(d1.var())

        d2_var = float(d2.var())
        # Binned entropy of d2
        if len(d2) > 0:
            bins = np.histogram(d2, bins=10)[0]
            d2_ent = float(-sum((b / len(d2)) * math.log2(b / len(d2)) for b in bins if b > 0))
        else:
            d2_ent = 0.0

        # Autocorrelation lag 1 of d2
        if len(d2) > 1:
            d2c = d2 - d2.mean()
            denom = (d2c ** 2).sum()
            d2_ac = float((d2c[:-1] * d2c[1:]).sum() / (denom + 1e-9))
        else:
            d2_ac = 0.0

        return np.array([s_mean, s_var, s_skew, s_kurt, d1_mean, d1_var, d2_var, d2_ent, d2_ac], dtype=float)
    except Exception as e:
        return np.zeros(9, dtype=float)


def cluster_ai_detection(texts, labels, sample_per_cluster=20):
    """
    Sample per cluster, compute surprisal features, aggregate at cluster level.

    The key signal: a cluster where the SURPRISAL VARIANCE across comments is
    suspiciously LOW compared to the rest of the docket = AI signature.

    We compute:
      1. Per-comment surprisal features (9 dims from GPT-2)
      2. Per-cluster intra-cluster std for each feature
      3. Compare to docket-wide intra-feature std (leave-cluster-out)
      4. Score = mean over features of (1 - cluster_std / baseline_std)

    Returns dict[cluster_id -> ai_stats].
    """
    model, tokenizer = _load_gpt2()
    if model is None:
        return {}

    cluster_ids = sorted(set(labels.tolist()) if hasattr(labels, "tolist") else set(labels))

    # First, compute features for a global sample to get baseline std
    n = len(texts)
    sample_global = np.random.RandomState(42).choice(n, min(150, n), replace=False)
    print(f"  Computing baseline surprisal features for {len(sample_global)} comments...")
    baseline_feats = []
    for i, idx in enumerate(sample_global):
        if i > 0 and i % 50 == 0:
            print(f"    {i}/{len(sample_global)}")
        f = compute_surprisal_features(texts[idx], model, tokenizer)
        if np.any(f != 0):
            baseline_feats.append(f)
    if not baseline_feats:
        return {}
    baseline = np.vstack(baseline_feats)
    baseline_std = baseline.std(axis=0, ddof=0) + 1e-6  # per-feature std

    results = {}
    for cl in cluster_ids:
        if cl == -1:
            continue
        member_indices = [i for i, l in enumerate(labels) if l == cl]
        if len(member_indices) < 3:
            continue

        sample = member_indices[:sample_per_cluster]
        feats = []
        for idx in sample:
            f = compute_surprisal_features(texts[idx], model, tokenizer)
            if np.any(f != 0):
                feats.append(f)

        if len(feats) < 3:
            continue

        F = np.vstack(feats)
        cluster_std = F.std(axis=0, ddof=0) + 1e-9
        cluster_mean = F.mean(axis=0)

        # Per-feature std ratio: cluster std / baseline std
        std_ratio = cluster_std / baseline_std  # < 1 means cluster is tighter

        # Use log-ratio with confidence-weighting on cluster size.
        # For small clusters (n<10), discount heavily.
        size_factor = min(1.0, len(feats) / 15.0)

        # Mean log std-ratio (more negative = more suspicious)
        mean_log_ratio = float(np.mean(np.log(std_ratio + 0.01)))
        # Map to (0, 1): -2 → 0.86, -1 → 0.63, 0 → 0
        ai_raw = 1.0 - math.exp(mean_log_ratio)
        ai_raw = max(0.0, min(0.95, ai_raw))
        ai_score = round(size_factor * ai_raw, 4)

        results[int(cl)] = {
            "n_sampled": len(feats),
            "mean_surprisal": round(float(cluster_mean[0]), 3),
            "cluster_surprisal_std": round(float(cluster_std[0]), 3),
            "baseline_surprisal_std": round(float(baseline_std[0]), 3),
            "ai_score": round(ai_score, 4),
            "median_std_ratio": round(float(np.median(std_ratio)), 4),
            "interpretation": "ai_likely" if ai_score > 0.6 else "uncertain" if ai_score > 0.3 else "human_likely",
        }
    return results
