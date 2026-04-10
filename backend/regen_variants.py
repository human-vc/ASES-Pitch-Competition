#!/usr/bin/env python3
"""
Regenerate cluster member comments with HIGH variation.
Reads the existing synthetic_data.json, asks Claude to generate ~40 varied
paraphrases per cluster, then redistributes the variants across cluster members.

Result: each cluster has 40 unique variants instead of the same 5 templates repeated.
"""

import os
import sys
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from config import ANTHROPIC_API_KEY

import anthropic

INPUT = "/Users/jacobcrainic/ASES-Pitch-Competition/demo/public/synthetic_data.json"

PROMPT = """You are generating variants of a coordinated public comment campaign for a regulatory comment dataset.

I need {n} variants of this seed comment. Each variant must:
- Keep the EXACT SAME core argument and policy position
- Use COMPLETELY DIFFERENT vocabulary, sentence structures, opening, and tone
- Range from 50 to 200 words
- Sound like different individual people wrote them: some terse, some rambling, some folksy, some formal, some angry, some hesitant
- INCLUDE REALISTIC HUMAN ELEMENTS like personal anecdotes, hedging, typos, run-on sentences when appropriate
- Vary opening style: never start two with "I", never repeat opening phrases
- Each must read as if written by a genuinely different person

SEED COMMENT:
\"\"\"
{seed}
\"\"\"

Output: A JSON array of {n} strings, no other text. No code fences. Start with [ and end with ]."""


def gen_batch(client, seed, n=40):
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=12000,
            temperature=1.0,
            messages=[{"role": "user", "content": PROMPT.format(n=n, seed=seed[:800])}],
        )
        raw = resp.content[0].text.strip()
        # Strip code fences
        if "```" in raw:
            for part in raw.split("```"):
                p = part.strip()
                if p.startswith("json"):
                    p = p[4:].strip()
                if p.startswith("["):
                    raw = p
                    break
        # Find first [ and last ]
        start = raw.find("[")
        end = raw.rfind("]")
        if start >= 0 and end > start:
            raw = raw[start:end + 1]
        variants = json.loads(raw)
        return [v for v in variants if isinstance(v, str) and 30 < len(v) < 2000]
    except Exception as e:
        print(f"  [error] {type(e).__name__}: {str(e)[:120]}")
        return []


def main():
    if not ANTHROPIC_API_KEY:
        print("ANTHROPIC_API_KEY not set")
        return

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    print(f"Loading {INPUT}")
    with open(INPUT) as f:
        data = json.load(f)

    print(f"Loaded {len(data['clusters'])} clusters, {len(data['comments_data'])} comments")

    # For each cluster: pick a seed comment, generate 40 variants, distribute
    # Process in parallel batches of 6
    cluster_seeds = []
    for cluster in data["clusters"]:
        cl_id = cluster["cluster_id"]
        member_idxs = [i for i, l in enumerate(data["labels"]) if l == cl_id]
        if len(member_idxs) < 3:
            continue
        # Get a seed from the first member
        seed_id = data["comment_ids"][member_idxs[0]]
        seed_text = data["comments_data"].get(seed_id, {}).get("text", "")
        if not seed_text or len(seed_text) < 30:
            continue
        cluster_seeds.append({
            "cluster_id": cl_id,
            "members": member_idxs,
            "seed": seed_text,
            "n_target": min(40, max(10, len(member_idxs))),
        })

    print(f"Will generate variants for {len(cluster_seeds)} clusters")
    print(f"Estimated cost: ~${len(cluster_seeds) * 0.01:.2f}\n")

    results = {}

    def process(c):
        variants = gen_batch(client, c["seed"], n=c["n_target"])
        return c["cluster_id"], c["members"], variants

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(process, c) for c in cluster_seeds]
        for i, fut in enumerate(as_completed(futures)):
            try:
                cl_id, members, variants = fut.result()
                if variants:
                    results[cl_id] = (members, variants)
                    print(f"  [{i+1}/{len(cluster_seeds)}] CLUS {cl_id}: {len(variants)} variants")
                else:
                    print(f"  [{i+1}/{len(cluster_seeds)}] CLUS {cl_id}: NO VARIANTS (kept original)")
            except Exception as e:
                print(f"  [error] {e}")

    # Distribute variants across cluster members (cycle through if needed)
    n_replaced = 0
    rng = random.Random(42)
    for cl_id, (members, variants) in results.items():
        if not variants:
            continue
        for i, member_idx in enumerate(members):
            cid = data["comment_ids"][member_idx]
            if cid in data["comments_data"]:
                # Random variant per member (with replacement so all members differ)
                v = variants[rng.randrange(len(variants))]
                data["comments_data"][cid]["text"] = v
                n_replaced += 1

    print(f"\nReplaced {n_replaced} comment texts")

    # Update sample_comments on each cluster (these get shown in the table)
    for cluster in data["clusters"]:
        cl_id = cluster["cluster_id"]
        member_idxs = [i for i, l in enumerate(data["labels"]) if l == cl_id]
        samples = []
        for idx in member_idxs[:5]:
            cid = data["comment_ids"][idx]
            txt = data["comments_data"].get(cid, {}).get("text", "")
            samples.append(txt[:300])
        cluster["sample_comments"] = samples

    with open(INPUT, "w") as f:
        json.dump(data, f)
    print(f"Saved {INPUT}, size: {os.path.getsize(INPUT)/1024:.0f} KB")


if __name__ == "__main__":
    main()
