import os
import random
import numpy as np

# ── API Keys ────────────────────────────────────────────────
REGS_API_BASE = "https://api.regulations.gov/v4"
REGS_API_KEY = os.environ.get("REGULATIONS_GOV_API_KEY", "DEMO_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")

# ── Ingestion ───────────────────────────────────────────────
PAGE_SIZE = 250
RATE_LIMIT_PER_HOUR = 900
BACKOFF_BASE = 2.0
MAX_RETRIES = 5
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "docketlens.db")

# ── Embedding (Voyage AI) ───────────────────────────────────
EMBED_PROVIDER = "voyage"
EMBED_MODEL = "voyage-3-large"
EMBED_DIM = 1024
EMBED_BATCH_SIZE = 128       # Voyage allows up to 128 per request

# ── Clustering (UMAP/densMAP + HDBSCAN-leaf) ────────────────
UMAP_N_NEIGHBORS = 30
UMAP_N_COMPONENTS = 15
UMAP_MIN_DIST = 0.0
UMAP_METRIC = "cosine"
UMAP_DENSMAP = True          # density-preserving — key for variable-density clusters
UMAP_DENS_LAMBDA = 2.0
HDBSCAN_MIN_CLUSTER = 5      # leaf mode: small to catch organic clusters
HDBSCAN_MIN_SAMPLES = 2
HDBSCAN_SELECTION = "leaf"
CAMPAIGN_MIN_SIZE = 100      # tree-walk threshold (only triggers at scale)
ENABLE_TREE_WALK = False     # disable for small dockets where it's not useful

# ── Duplicate Detection ─────────────────────────────────────
MINHASH_NUM_PERM = 128
LSH_THRESHOLD = 0.5

# ── Temporal ────────────────────────────────────────────────
BURST_WINDOW_HOURS = 1
BURST_ZSCORE_THRESH = 3.0

# ── Stylometrics ────────────────────────────────────────────
FK_UNIFORMITY_THRESH = 2.0

# ── Fingerprinting ──────────────────────────────────────────
FINGERPRINT_SAMPLE_PER_CLUSTER = 15
FINGERPRINT_MAX_CLUSTERS = 30           # cap for cost; tune up for full coverage
FINGERPRINT_MIN_CLUSTER_SIZE = 15
FINGERPRINT_MODEL = "claude-haiku-4-5"

# ── Campaign Scoring Weights ────────────────────────────────
W_DUPLICATE = 0.20
W_BURST = 0.15           # temporal coupling
W_STYLE = 0.20           # stylometric variance ratio
W_COMPRESS = 0.05        # legacy, folded into stylometric
W_FINGERPRINT = 0.20     # argument identity
W_AI = 0.15              # DivEye cluster-aggregated
W_PROBE = 0.05           # paraphrase reachability bonus
CAMPAIGN_THRESHOLD = 0.40

# ── Pipeline ────────────────────────────────────────────────
SEED = 42
DEMO_DOCKET = "CFPB-2024-0002"  # Overdraft Lending: Very Large Financial Institutions (48K comments)
DEMO_SUBSET = 5000


def seed_everything(seed=SEED):
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
    except ImportError:
        pass
