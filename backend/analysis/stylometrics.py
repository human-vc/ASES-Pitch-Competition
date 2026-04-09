"""
Stylometric campaign detection at the cluster level.

Computes 19 stylometric features per comment, then for each cluster computes a
Generalized Variance Ratio (GVR) and Box's M test against the docket-wide baseline.
Low intra-cluster stylometric variance = campaign signal.

Reference: synthesis of Mosteller-Wallace (1964), Goh-Barabási (2008),
McCarthy-Jarvis (2010 MTLD), Kobak et al. (2025 LLM-isms), DivEye (TMLR 2026).
"""

import math
import zlib
import warnings
from collections import Counter
import numpy as np
import textstat
import spacy
from lexicalrichness import LexicalRichness
from scipy.stats import chi2 as chi2_dist
from sklearn.covariance import MinCovDet, EmpiricalCovariance

warnings.filterwarnings("ignore")

# Loaded lazily to avoid 1.5s startup cost when not needed
_NLP = None


def _get_nlp():
    global _NLP
    if _NLP is None:
        _NLP = spacy.load("en_core_web_sm", disable=["ner", "lemmatizer"])
    return _NLP


# Mosteller-Wallace 70 function words
MW70 = {
    "a","all","also","an","and","any","are","as","at","be","been","but",
    "by","can","do","down","even","every","for","from","had","has","have",
    "her","his","if","in","into","is","it","its","may","more","must","my",
    "no","not","now","of","on","one","only","or","our","shall","should",
    "so","some","such","than","that","the","their","then","there","things",
    "this","to","up","upon","was","were","what","when","which","who","will",
    "with","would","your",
}

# LLM-ism wordlist (Kobak et al. 2025 + extensions)
LLMISMS = {
    "delve","tapestry","leverage","navigate","foster","embark","underscore",
    "showcase","streamline","facilitate","elucidate","realm","landscape",
    "framework","ecosystem","cornerstone","paradigm","robust","seamless",
    "intricate","nuanced","pivotal","crucial","vital","comprehensive",
    "holistic","innovative","transformative",
}

DISCOURSE = {
    "however","therefore","moreover","furthermore","additionally","indeed",
    "thus","hence","consequently","nevertheless","nonetheless","accordingly",
}

PUNCT_SET = list(".,;:!?—-\"'")

FEATURE_NAMES = [
    # Burstiness (2)
    "burstiness_sent", "sent_len_cv",
    # Lexical richness (4)
    "mtld", "yule_k", "hapax_ratio", "ttr",
    # Word/character (2)
    "avg_word_len", "char_trigram_entropy",
    # Punctuation (2)
    "punct_entropy", "emdash_rate",
    # Function words (1)
    "fw_chi2_vs_docket",
    # Readability (3)
    "flesch_kincaid", "coleman_liau", "gunning_fog",
    # Syntax (2)
    "dep_depth_mean", "pos_entropy",
    # Discourse / LLM tells (2)
    "discourse_marker_rate", "llmism_rate",
    # Compression (1)
    "zlib_ratio",
]
N_FEATURES = len(FEATURE_NAMES)  # 19


def _shannon(counts):
    total = sum(counts)
    if total == 0:
        return 0.0
    return -sum((c / total) * math.log2(c / total) for c in counts if c > 0)


def _char_ngram_entropy(text, n=3):
    if len(text) < n:
        return 0.0
    grams = Counter(text[i:i+n] for i in range(len(text) - n + 1))
    return _shannon(list(grams.values()))


def _burstiness(vals):
    v = np.asarray(vals, dtype=float)
    if v.size < 2:
        return 0.0
    mu, sigma = v.mean(), v.std(ddof=0)
    denom = mu + sigma
    return float((sigma - mu) / denom) if denom > 0 else 0.0


def _dep_depth(doc):
    def depth(tok):
        d, cur = 0, tok
        while cur.head is not cur:
            cur = cur.head
            d += 1
            if d > 200:
                break
        return d
    depths = [max((depth(t) for t in sent), default=0) for sent in doc.sents]
    return float(np.mean(depths)) if depths else 0.0


def compute_docket_fw_baseline(texts):
    """Precompute docket-wide MW70 word frequencies for chi-square baseline."""
    total = 0
    counts = Counter()
    for t in texts:
        if not t:
            continue
        toks = [w.lower() for w in t.split()]
        total += len(toks)
        counts.update(w for w in toks if w in MW70)
    return {w: (counts[w] / total if total else 0.0) for w in MW70}


def _fw_chi2(text, baseline):
    toks = [w.lower() for w in text.split()]
    N = len(toks)
    if N == 0:
        return 0.0
    obs = Counter(w for w in toks if w in MW70)
    chi2 = 0.0
    for w in MW70:
        O = obs.get(w, 0)
        E = baseline[w] * N
        if E > 0.5:
            chi2 += (O - E) ** 2 / E
    return chi2


def compute_features(text, fw_baseline):
    """Returns a 19-dim feature vector for one comment."""
    if not text or len(text.split()) < 5:
        return np.zeros(N_FEATURES, dtype=float)

    nlp = _get_nlp()
    doc = nlp(text[:50000])  # spaCy memory cap
    sents = list(doc.sents)
    sent_lens = [len([t for t in s if not t.is_punct]) for s in sents]
    words = [t.text for t in doc if t.is_alpha]
    N = max(len(words), 1)

    # Burstiness
    burst = _burstiness(sent_lens)
    cv = (np.std(sent_lens) / np.mean(sent_lens)) if sent_lens and np.mean(sent_lens) > 0 else 0.0

    # Lexical richness
    try:
        lr = LexicalRichness(text)
        mtld = lr.mtld(threshold=0.72) if lr.words >= 50 else 0.0
        yule = lr.yulek if lr.words >= 10 else 0.0
        ttr = lr.ttr if lr.words >= 1 else 0.0
    except Exception:
        mtld = yule = ttr = 0.0

    freqs = Counter(w.lower() for w in words)
    hapax = sum(1 for c in freqs.values() if c == 1) / max(len(freqs), 1)

    # Word/char
    avg_wlen = float(np.mean([len(w) for w in words])) if words else 0.0
    char_ent = _char_ngram_entropy(text.lower(), 3)

    # Punctuation
    punct_counts = [sum(1 for t in doc if t.text == p) for p in PUNCT_SET]
    punct_ent = _shannon(punct_counts)
    emdash_rate = text.count("—") / N

    # Function words chi-square
    fw_chi2 = _fw_chi2(text, fw_baseline)

    # Readability
    try:
        fk = textstat.flesch_kincaid_grade(text)
        cl = textstat.coleman_liau_index(text)
        gf = textstat.gunning_fog(text)
    except Exception:
        fk = cl = gf = 0.0

    # Syntax
    dep_d = _dep_depth(doc)
    pos_counts = Counter(t.pos_ for t in doc if not t.is_space)
    pos_ent = _shannon(list(pos_counts.values()))

    # Discourse / LLM tells
    lowered = [w.lower() for w in words]
    dm_rate = sum(1 for w in lowered if w in DISCOURSE) / N
    llm_rate = sum(1 for w in lowered if w in LLMISMS) / N

    # Compression
    raw = text.encode("utf-8")
    comp = len(zlib.compress(raw)) / max(len(raw), 1)

    return np.array([
        burst, cv,
        mtld, yule, hapax, ttr,
        avg_wlen, char_ent,
        punct_ent, emdash_rate,
        fw_chi2,
        fk, cl, gf,
        dep_d, pos_ent,
        dm_rate, llm_rate,
        comp,
    ], dtype=float)


def compute_docket_matrix(texts):
    """Compute the (n, 19) feature matrix for all comments in a docket."""
    print(f"  Computing stylometric features for {len(texts)} comments")
    fw_baseline = compute_docket_fw_baseline(texts)
    rows = []
    for i, t in enumerate(texts):
        if i % 200 == 0 and i > 0:
            print(f"    {i}/{len(texts)}")
        rows.append(compute_features(t, fw_baseline))
    X = np.vstack(rows)
    # Replace NaN/inf with column medians
    col_med = np.nanmedian(X, axis=0)
    inds = np.where(~np.isfinite(X))
    X[inds] = np.take(col_med, inds[1])
    return X, fw_baseline


def cluster_campaign_scores(X, labels):
    """
    Per-cluster stylometric tightness scoring using LEAVE-CLUSTER-OUT baseline
    with diagonal variance (robust on small dockets).

    Score = geometric mean of (1 - cluster_var_f / baseline_var_f) clipped to [0, 1].
    A cluster where every feature has lower variance than the rest of the docket
    is suspicious — the lower the relative variance, the higher the score.

    Returns dict[cluster_id -> stats].
    """
    d = X.shape[1]
    n = X.shape[0]

    # Standardize features so they're comparable in scale
    feat_means = X.mean(axis=0)
    feat_stds = X.std(axis=0, ddof=0) + 1e-9
    Xn = (X - feat_means) / feat_stds

    results = {}
    label_set = set(labels.tolist()) if hasattr(labels, "tolist") else set(labels)

    for cl in label_set:
        if cl == -1:
            continue
        idx = np.where(labels == cl)[0] if hasattr(labels, "shape") else np.array([i for i, l in enumerate(labels) if l == cl])
        n_c = len(idx)
        if n_c < 3:
            continue

        Xc = Xn[idx]

        # Leave-cluster-out baseline: variance of all OTHER comments
        mask = np.ones(n, dtype=bool)
        mask[idx] = False
        if mask.sum() < 5:
            baseline_var = np.var(Xn, axis=0, ddof=0)
        else:
            X_rest = Xn[mask]
            baseline_var = np.var(X_rest, axis=0, ddof=0)
        baseline_var = np.maximum(baseline_var, 1e-6)

        cluster_var = np.var(Xc, axis=0, ddof=0)
        cluster_var = np.maximum(cluster_var, 1e-9)

        var_ratio = cluster_var / baseline_var
        std_ratio = np.sqrt(var_ratio)

        # Mean log of std ratio — negative = tighter
        mean_log_ratio = float(np.mean(np.log(std_ratio + 0.01)))

        # Map to (0, 1) with no saturation: 1 - exp(mean_log_ratio)
        # Cluster size factor — small clusters get downweighted
        size_factor = min(1.0, n_c / 20.0)

        raw_score = 1.0 - math.exp(mean_log_ratio)
        raw_score = max(0.0, min(0.95, raw_score))
        primary_score = float(round(size_factor * raw_score, 4))

        # Bartlett-style chi-square approx for p-value
        with np.errstate(divide="ignore", invalid="ignore"):
            chi_stat = max(0.0, -float((n_c - 1) * np.sum(np.log(var_ratio))))
        p_value = float(chi2_dist.sf(chi_stat, df=d))

        median_var_ratio = float(np.median(var_ratio))

        results[int(cl)] = {
            "n_members": int(n_c),
            "campaign_score": primary_score,
            "p_value": float(p_value),
            "median_variance_ratio": round(median_var_ratio, 4),
            "chi_stat": round(chi_stat, 2),
            "std_ratio": [round(x, 4) for x in std_ratio.tolist()],
            "feature_names": FEATURE_NAMES,
        }
    return results
