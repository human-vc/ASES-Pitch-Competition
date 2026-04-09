# DocketLens

Regulatory comment intelligence platform: detects coordinated astroturfing campaigns in federal public comments.

Built for the ASES Pitch Competition.

## Structure

```
.
├── demo.html              # Standalone canvas pitch demo (3 beats)
├── demo/                  # Next.js scaffold
└── backend/               # Python ML pipeline
    ├── config.py
    ├── run_pipeline.py    # CLI entry point
    ├── synthetic.py       # LLM-generated synthetic test data with ground truth
    ├── ingestion/         # regulations.gov API client + SQLite storage
    ├── analysis/          # 12 detection signals
    │   ├── embedding.py           # Voyage AI 1024-dim embeddings
    │   ├── clustering.py          # densMAP + leaf HDBSCAN + soft membership
    │   ├── duplicates.py          # MinHash LSH near-duplicate detection
    │   ├── temporal.py            # Kulldorff temporal scan statistic
    │   ├── stylometrics.py        # 19-feature variance ratio + Box's M
    │   ├── geographic.py          # Geographic concentration (entropy/KL)
    │   ├── entities.py            # OpenSecrets entity resolution
    │   ├── duplicate_chain.py     # Exact → near → paraphrase gradient
    │   ├── argument_identity.py   # Claude Haiku argument structure extraction
    │   ├── coordination.py        # Leiden community detection on multi-edge graph
    │   ├── ai_detection.py        # DivEye-style surprisal variance
    │   ├── paraphrase_probe.py    # Counterfactual paraphrase reachability
    │   └── pipeline.py            # Orchestrator: scoring + classification
    └── api/                       # FastAPI server
```

## Setup

### Backend (Python pipeline)

```bash
cd backend
pip install -r requirements.txt
python -m spacy download en_core_web_sm

Set API keys
export VOYAGE_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export REGULATIONS_GOV_API_KEY="..."  from api.data.gov
```

The repo ships with a pre-computed SQLite cache (`backend/data/docketlens.db`)
containing 2900 synthetic comments and their Voyage embeddings, plus
pre-computed analysis results in `backend/data/*_results.json`. This means you
can run the pipeline immediately without paying for embedding/ingestion API calls.

### Frontend (canvas demo)

```bash
# The standalone canvas demo is just a single HTML file
open demo.html

# Or for the Next.js scaffold:
cd demo
npm install   # ~30 sec (node_modules excluded from repo, regenerable)
npm run dev
```

## Usage

```bash
Generate synthetic test data with ground truth
python synthetic.py --n_organic 300 --n_personas 100

Run full pipeline on synthetic data
python run_pipeline.py --docket_id SYNTHETIC-NET-NEUTRALITY-2026 --skip_ingestion

Or analyze a real CFPB docket
python run_pipeline.py --docket_id CFPB-2024-0002 --max_comments 500
```

## Detection Signals

Each cluster gets scored across 12 independent signal dimensions, then combined into a composite campaign score (0-1):

| Signal | Method | Cost |
|--------|--------|------|
| Semantic clustering | Voyage `voyage-3-large` + UMAP/densMAP + HDBSCAN(leaf) | API |
| Argument identity | Claude Haiku structured extraction + Jaccard scoring | API |
| Temporal coupling | Kulldorff (1997) temporal scan statistic | local |
| Stylometric variance | 19 features, leave-cluster-out variance ratio + Box's M | local |
| Near-duplicate chain | MinHash LSH (word k=5 shingles) + union-find | local |
| Geographic concentration | Shannon entropy + KL divergence vs docket | local |
| Entity resolution | Fuzzy match against 42-org lobbying registry | local |
| Coordination network | Leiden community detection on multi-edge graph | local |
| AI text detection | DivEye-style surprisal variance (GPT-2 small) | local |
| Counterfactual paraphrase | Claude generates 30 paraphrases → check cluster reachability | API |
| Cross-docket fingerprint | Argument hash storage for future-docket matching | local |
| Duplicate gradient viz | Exact → near → paraphrased sophistication tier | local |
