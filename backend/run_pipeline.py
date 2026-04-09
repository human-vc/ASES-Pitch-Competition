#!/usr/bin/env python3
"""DocketLens: Regulatory Comment Intelligence Pipeline"""

import sys
import os
import json
import argparse

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from config import SEED, DEMO_DOCKET, DEMO_SUBSET, DB_PATH, seed_everything
from ingestion.db import init_db, _json_safe
from ingestion.client import RegsClient
from analysis.embedding import load_encoder, embed_comments
from analysis.pipeline import run_full_analysis


def main():
    parser = argparse.ArgumentParser(description="DocketLens: Regulatory Comment Intelligence")
    parser.add_argument("--docket_id", default=DEMO_DOCKET, help="Docket ID to analyze")
    parser.add_argument("--max_comments", type=int, default=DEMO_SUBSET, help="Max comments to ingest")
    parser.add_argument("--skip_ingestion", action="store_true", help="Skip API ingestion, use cached data")
    parser.add_argument("--skip_fingerprint", action="store_true", help="Skip Claude API argument extraction")
    parser.add_argument("--skip_ai_detection", action="store_true", help="Skip GPT-2 surprisal AI detection")
    parser.add_argument("--skip_paraphrase_probe", action="store_true", help="Skip counterfactual paraphrase probing")
    parser.add_argument("--db_path", default=DB_PATH, help="SQLite database path")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  DOCKETLENS PIPELINE")
    print(f"  Docket: {args.docket_id}")
    print(f"  Max comments: {args.max_comments}")
    print(f"{'='*60}")

    seed_everything(SEED)
    conn = init_db(args.db_path)

    # 1. Ingest
    if not args.skip_ingestion:
        client = RegsClient()
        client.ingest_docket(args.docket_id, conn, max_comments=args.max_comments)
    else:
        print("\n  [skip] Using cached data")

    # 2. Embed
    encoder = load_encoder()

    # 3. Full analysis
    result = run_full_analysis(
        conn, args.docket_id,
        encoder=encoder,
        skip_fingerprint=args.skip_fingerprint,
        skip_ai_detection=args.skip_ai_detection,
        skip_paraphrase_probe=args.skip_paraphrase_probe,
    )

    if result:
        out_path = os.path.join(os.path.dirname(__file__), "data", f"{args.docket_id}_results.json")
        save_result = {k: v for k, v in result.items() if k not in ("coords_2d", "comment_ids", "labels")}
        with open(out_path, "w") as f:
            json.dump(_json_safe(save_result), f, indent=2)
        print(f"\n  Results saved to: {out_path}")

    conn.close()
    print("\n  Done.\n")


if __name__ == "__main__":
    main()
