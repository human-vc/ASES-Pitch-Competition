#!/usr/bin/env python3
"""
Synthetic comment generator for DocketLens demo — v2.

Hybrid approach (research-validated):
- ORGANIC comments: Claude Haiku with persona conditioning + anti-repetition.
  Each comment is generated against a unique, randomized persona at temp=1.0.
  Anti-repetition: last 3 generated comments are passed in as "don't write like these".
  Result: maximally diverse, no two comments alike, no false clusters.

- CAMPAIGN comments: Claude Haiku batch paraphrasing of seed templates at temp=0.7.
  Each campaign has a canonical seed comment, paraphrased N times in cohesive batches.
  Result: tight clusters with distinct vocabulary but identical argument structure.

Validation: built-in ARI/NMI check against ground-truth labels using UMAP+HDBSCAN.
Target: ARI > 0.85 (organic should NOT cluster, campaigns SHOULD cluster).

References:
- Chan et al. 2024 (arXiv:2406.20094) "Scaling Synthetic Data with 1B Personas"
- Jeff Kao (2017) Stanford CIS / Hacker Noon, FCC fake comment study
- NY AG Report (2021) on FCC astroturfing methodology
"""

import os
import sys
import json
import time
import random
import argparse
import hashlib
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
from config import DB_PATH, ANTHROPIC_API_KEY
from ingestion.db import init_db, upsert_comment

import anthropic

SYNTHETIC_DOCKET = "SYNTHETIC-NET-NEUTRALITY-2026"
DOCKET_TITLE = "Restoring Internet Freedom — Synthetic Demo"
PERSONA_CACHE = os.path.join(os.path.dirname(__file__), "data", "personas.json")
HAIKU_MODEL = "claude-haiku-4-5"

# ─── PERSONA SEED TRAITS (for diversity scaffolding) ──────────────
SEED_TRAITS = [
    "62-year-old retired Army medic in rural Alabama who runs a beekeeping side business",
    "29-year-old Vietnamese-American software engineer in San Jose with two kids in elementary school",
    "47-year-old Black church organist in Memphis with chronic back pain and a side hustle teaching piano",
    "21-year-old college student majoring in marine biology at UC Santa Barbara",
    "55-year-old white widow on a fixed income in rural Kansas who streams church services online",
    "38-year-old Latina school nurse in Phoenix dealing with a chronically ill kid",
    "70-year-old retired union electrician in Pittsburgh who watches conspiracy theory videos",
    "31-year-old Iraq war veteran in Detroit selling on eBay to make ends meet",
    "44-year-old single father in rural Maine who fishes commercially and works construction in winter",
    "26-year-old trans woman in Portland working as a barista and freelance illustrator",
    "59-year-old Korean-American restaurant owner in Atlanta who barely speaks English",
    "33-year-old farmer in Iowa managing 800 acres of corn and soybeans",
    "48-year-old recovering addict in West Virginia working at a Dollar General",
    "67-year-old Hopi grandmother in Arizona with no broadband at home",
    "25-year-old DACA recipient in Los Angeles working two restaurant jobs",
    "52-year-old NRA member and locksmith in Tennessee who hunts elk",
    "39-year-old radiologist in Boston who reads scans for rural hospitals over telehealth",
    "60-year-old retired teacher in Vermont running a small organic farm",
    "28-year-old Marine Corps wife in North Carolina homeschooling three kids",
    "73-year-old Holocaust survivor's daughter in Brooklyn writing a memoir",
    "19-year-old gas station attendant in rural Mississippi taking online community college classes",
    "41-year-old Mormon dad of seven in suburban Salt Lake City who works in finance",
    "34-year-old environmental activist in Oakland organizing tenant rights",
    "56-year-old long-haul trucker in Wyoming with a CB radio nostalgia",
    "29-year-old union plumber in Boston who grew up in Dorchester",
    "46-year-old Cambodian refugee in Long Beach running a donut shop",
    "37-year-old Twitch streamer in Austin who plays competitive FPS games",
    "63-year-old retired postal worker in Baltimore with diabetes",
    "22-year-old new mother in rural Oregon whose husband is in the Coast Guard",
    "51-year-old hedge fund analyst in Greenwich CT who reads obscure economics blogs",
    "30-year-old AI researcher at a Boston startup",
    "45-year-old veterinarian in rural North Dakota with a mobile practice",
    "68-year-old Japanese-American gardener in Sacramento, son of internment survivors",
    "23-year-old DoorDash driver in Las Vegas saving up for tech school",
    "57-year-old Methodist pastor in Indiana whose congregation is dying off",
    "40-year-old Puerto Rican mechanical engineer in Orlando still recovering from Hurricane Maria",
    "32-year-old high-school chemistry teacher in suburban Cleveland",
    "65-year-old anti-vaxxer organic farmer in northern California",
    "27-year-old prison guard in rural Texas with a deaf wife",
    "50-year-old Sikh truck-stop owner in central Pennsylvania",
    "35-year-old podcast producer in DC covering criminal justice reform",
    "44-year-old construction foreman in Albuquerque organizing for higher wages",
    "58-year-old librarian in Burlington Vermont running senior tech literacy classes",
    "24-year-old sex worker in Las Vegas dealing with payment processor discrimination",
    "61-year-old fly fishing guide in Montana whose business depends on Instagram",
    "36-year-old special ed teacher in Brooklyn whose autistic students depend on YouTube",
    "49-year-old African-American real estate agent in Houston",
    "20-year-old aspiring rapper in Chicago South Side promoting on TikTok",
    "54-year-old bee removal specialist in central Florida",
    "42-year-old Mormon mother of six in Provo who runs an Etsy shop",
]


# ─── PROMPTS ──────────────────────────────────────────────────────
PERSONA_GEN_PROMPT = """Generate a JSON persona for a US person about to write a public comment to the FCC on net neutrality. Make them SPECIFIC and UNUSUAL — avoid stereotypes. Give them a rare combination of traits.

Required fields (return only JSON):
{{"name": "First Last", "age": int, "occupation": "...", "city": "...", "state": "STATE", "education": "...", "political_lean": "pro_neutrality|anti_regulation|mixed", "tech_savviness": 1-5, "writing_style": "terse|rambling|formal|folksy|angry|academic|emotional|sarcastic|hesitant|confident|wonky", "personal_stake": "1-2 sentences explaining concretely why they care", "quirk": "one unusual thing about their life", "vocabulary_level": "plain|intermediate|advanced", "typical_sentence_length": "short|medium|long|mixed"}}

Seed trait to incorporate: {seed}
Persona #{idx}:"""

ORGANIC_SYSTEM = """You are simulating a specific American writing a public comment to the FCC about net neutrality. Stay completely in character. Write in THEIR voice — their vocabulary, sentence rhythm, level of formality.

Real comments are imperfect: some ramble, some are terse, some have typos, some open with personal stories, some are angry, some cite specific events. Length varies wildly: 20 to 250 words.

NEVER use corporate-sounding phrases like "I urge the Commission" unless the persona is a policy wonk. NEVER start with "As a..." — find a more natural opener. Write only the comment body, no preamble or labels."""

ORGANIC_USER = """PERSONA:
{persona_json}

Write this person's public comment on the FCC net neutrality proposal. Match their voice exactly.

{anti_repeat}

Write only the comment body."""

CAMPAIGN_SYSTEM = """You are generating AI-paraphrased variants of a coordinated public comment campaign. Each variant MUST:
- Keep the EXACT same core argument and policy position as the seed
- Keep the EXACT same logical structure and roughly the same key phrases
- Be a MINOR rewrite — swap a few words, restructure 1-2 sentences, but keep the same vocabulary feel
- Stay between 80-160 words
- Sound like the same campaign with very minor surface variation (the kind of thing a mail-merge with synonym substitution would produce)
- NOT introduce new arguments or change the policy ask
- NOT diverge stylistically — preserve the exact same tone and word choice patterns

Think: "5% vocabulary swaps, 10% sentence reordering, 85% identical." This is what real coordinated campaigns look like.

Output format: each variant on its own line, prefixed with "---". No other text."""

CAMPAIGN_USER = """SEED COMMENT (the canonical template — preserve this closely):
\"\"\"
{seed}
\"\"\"

Generate {n} minor variants. Each on its own line, prefixed with ---.
Make small surface changes only. Keep the argument, structure, AND most of the wording identical."""


# ─── CAMPAIGN SEEDS (4 distinct campaigns) ────────────────────────
CAMPAIGNS = [
    {
        "id": "industry_template_a",
        "label": "Industry Template (Broadband Coalition)",
        "size": 600,
        "burst_window_minutes": 47,
        "burst_offset_days": 14,
        "burst_hour": 2,
        "lobbying_org": "Internet & Television Association",
        "geo_concentration": "Virginia",
        "seed": (
            "Title II regulations represent an outdated approach that fundamentally constrains "
            "the broadband investment America needs. By imposing common carrier obligations on "
            "modern internet services, the FCC creates regulatory uncertainty that chills innovation "
            "and slows network expansion to underserved communities. The free market, not government "
            "intervention, has driven every major advancement in internet technology. I urge the "
            "Commission to restore the light-touch framework that allowed the internet to flourish "
            "for two decades and reject the misguided 2015 reclassification."
        ),
    },
    {
        "id": "lead_gen_firm_b",
        "label": "Lead-Gen Firm: 'Defend Free Speech'",
        "size": 500,
        "burst_window_minutes": 72,
        "burst_offset_days": 21,
        "burst_hour": 14,
        "lobbying_org": "American Bankers Association",
        "geo_concentration": None,
        "seed": (
            "The First Amendment must extend to the digital realm. Net neutrality regulations, "
            "while well-intentioned, ultimately empower the federal government to control online "
            "speech. We the people should decide what content reaches us, not unelected bureaucrats "
            "in Washington. As a free American, I believe the marketplace of ideas should remain "
            "unburdened by federal mandates. I strongly oppose Title II classification and urge the "
            "FCC to restore internet freedom by repealing the 2015 rules."
        ),
    },
    {
        "id": "bot_network_c",
        "label": "Bot Network (Generic Anti-Reg)",
        "size": 400,
        "burst_window_minutes": 8,
        "burst_offset_days": 30,
        "burst_hour": 3,
        "lobbying_org": None,
        "geo_concentration": None,
        "seed": (
            "I oppose net neutrality. The free market should regulate the internet, not the federal "
            "government. Title II is bad for consumers and bad for innovation. The internet was fine "
            "before 2015 and government regulation slows progress. Restore internet freedom now by "
            "repealing the rules."
        ),
    },
    {
        "id": "student_script_d",
        "label": "Student Script (Coordinated)",
        "size": 200,
        "burst_window_minutes": 60,
        "burst_offset_days": 25,
        "burst_hour": 23,
        "lobbying_org": None,
        "geo_concentration": "Massachusetts",
        "seed": (
            "As a college student studying telecommunications policy, I recognize that Title II is "
            "outdated and harms the broadband investment my generation depends on. The 2015 rules "
            "were premature and the empirical evidence shows they reduced network investment. "
            "The FCC should restore the bipartisan light-touch framework that worked for two "
            "decades. Innovation requires regulatory certainty, and that means repealing Title II."
        ),
    },
]


# ─── PERSONA BANK ─────────────────────────────────────────────────
def _gen_persona(client, idx, seed):
    """Generate one persona JSON via Claude Haiku."""
    try:
        resp = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=400,
            temperature=1.0,
            messages=[{"role": "user", "content": PERSONA_GEN_PROMPT.format(seed=seed, idx=idx)}],
        )
        raw = resp.content[0].text.strip()
        # Strip code fences
        if "```" in raw:
            for part in raw.split("```"):
                p = part.strip()
                if p.startswith("json"):
                    p = p[4:].strip()
                if p.startswith("{"):
                    raw = p
                    break
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start:end + 1]
        return json.loads(raw)
    except Exception as e:
        return None


def build_persona_bank(client, n=200, force=False):
    """Generate or load a cache of N diverse personas."""
    if not force and os.path.exists(PERSONA_CACHE):
        with open(PERSONA_CACHE) as f:
            personas = json.load(f)
        if len(personas) >= n:
            print(f"  Loaded {len(personas)} personas from cache")
            return personas[:n]

    print(f"  Generating {n} personas via Claude Haiku...")
    personas = []
    seeds = SEED_TRAITS * (n // len(SEED_TRAITS) + 1)
    random.shuffle(seeds)

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_gen_persona, client, i, seeds[i]): i for i in range(n)}
        for i, fut in enumerate(as_completed(futures)):
            p = fut.result()
            if p:
                personas.append(p)
            if (i + 1) % 25 == 0:
                print(f"    {i+1}/{n}")

    print(f"  Generated {len(personas)} personas")
    os.makedirs(os.path.dirname(PERSONA_CACHE), exist_ok=True)
    with open(PERSONA_CACHE, "w") as f:
        json.dump(personas, f, indent=2)
    return personas


# ─── ORGANIC GENERATION ───────────────────────────────────────────
def _gen_organic_one(client, persona, recent):
    """Generate one organic comment for a persona, with anti-repetition."""
    anti_repeat = ""
    if recent:
        anti_repeat = "Avoid sounding like any of these recently-written comments:\n" + \
            "\n".join(f"- {c[:180]}..." for c in recent[-3:])
    try:
        resp = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=600,
            temperature=1.0,
            system=ORGANIC_SYSTEM,
            messages=[{
                "role": "user",
                "content": ORGANIC_USER.format(
                    persona_json=json.dumps(persona, indent=2),
                    anti_repeat=anti_repeat,
                ),
            }],
        )
        return resp.content[0].text.strip()
    except Exception as e:
        return None


def gen_organic_batch(client, personas, n_total):
    """Generate organic comments using personas, with anti-repetition tracking."""
    print(f"  Generating {n_total} organic comments...")
    comments = []
    persona_iter = (personas * (n_total // len(personas) + 1))[:n_total]
    random.shuffle(persona_iter)

    # Generate sequentially in mini-batches so we can track recent comments
    BATCH = 5
    for batch_start in range(0, n_total, BATCH):
        batch = persona_iter[batch_start:batch_start + BATCH]
        recent = [c["text"] for c in comments[-3:]] if comments else []

        # Generate this mini-batch in parallel — they all use the same recent context
        with ThreadPoolExecutor(max_workers=BATCH) as ex:
            futures = [ex.submit(_gen_organic_one, client, p, recent) for p in batch]
            for fut, p in zip(futures, batch):
                text = fut.result()
                if text:
                    comments.append({"text": text, "persona": p})

        if (batch_start + BATCH) % 50 == 0 or batch_start + BATCH >= n_total:
            print(f"    {min(batch_start + BATCH, n_total)}/{n_total}")

    return comments


# ─── CAMPAIGN GENERATION ──────────────────────────────────────────
def _gen_campaign_batch(client, seed, n=20):
    """Generate N paraphrased variants of a seed comment in one Claude call."""
    try:
        resp = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=8000,
            temperature=0.4,
            system=CAMPAIGN_SYSTEM,
            messages=[{"role": "user", "content": CAMPAIGN_USER.format(seed=seed, n=n)}],
        )
        raw = resp.content[0].text.strip()
        variants = []
        for chunk in raw.split("---"):
            chunk = chunk.strip()
            if len(chunk) > 30 and len(chunk) < 2000:
                variants.append(chunk)
        return variants
    except Exception as e:
        print(f"    [campaign batch error] {e}")
        return []


def gen_campaign(client, campaign_def):
    """Generate all paraphrased variants for one campaign."""
    print(f"  Generating campaign: {campaign_def['label']} ({campaign_def['size']} comments)")
    variants = []
    BATCH = 20
    n_batches = (campaign_def["size"] + BATCH - 1) // BATCH
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_gen_campaign_batch, client, campaign_def["seed"], BATCH)
                   for _ in range(n_batches)]
        for i, fut in enumerate(as_completed(futures)):
            variants.extend(fut.result())
            if (i + 1) % 5 == 0:
                print(f"    {min(len(variants), campaign_def['size'])}/{campaign_def['size']}")
    return variants[:campaign_def["size"]]


# ─── METADATA ─────────────────────────────────────────────────────
FIRST_NAMES = ["John", "Mary", "James", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
               "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph",
               "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy",
               "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Sandra", "Mark", "Dorothy",
               "Donald", "Ashley", "Steven", "Kimberly", "Paul", "Donna", "Andrew", "Emily",
               "Joshua", "Michelle", "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Melissa"]
LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
              "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
              "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
              "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker"]
STATES = ["CA", "TX", "FL", "NY", "PA", "IL", "OH", "GA", "NC", "MI", "VA", "WA", "MA",
          "AZ", "TN", "IN", "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA", "KY", "OR"]
CITIES = ["Portland", "Austin", "Madison", "Asheville", "Boulder", "Burlington", "Charleston",
          "Tucson", "Lansing", "Albany", "Hartford", "Tallahassee", "Lincoln", "Boise", "Helena",
          "Springfield", "Columbus", "Trenton", "Annapolis", "Frankfort", "Salem", "Olympia"]


def _gen_metadata(rng, persona=None, force_state=None):
    """Build name/location metadata. Use persona if available."""
    if persona and isinstance(persona, dict):
        name = persona.get("name", f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}")
        parts = name.split()
        first = parts[0] if parts else rng.choice(FIRST_NAMES)
        last = parts[-1] if len(parts) > 1 else rng.choice(LAST_NAMES)
        city = persona.get("city", rng.choice(CITIES))
        state = persona.get("state", rng.choice(STATES))[:2].upper()
    else:
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        city = rng.choice(CITIES)
        state = force_state if force_state else rng.choice(STATES)
    return first, last, city, state


# ─── MAIN GENERATION ──────────────────────────────────────────────
def generate_synthetic_docket(n_organic=400, base_time=None, db_path=DB_PATH,
                               docket_id=SYNTHETIC_DOCKET, n_personas=200,
                               regen_personas=False):
    """Build the synthetic docket."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY required for synthetic generation")

    if base_time is None:
        base_time = datetime(2025, 6, 1, 0, 0, 0, tzinfo=timezone.utc)

    print(f"\n{'='*60}")
    print(f"  GENERATING SYNTHETIC DOCKET (v2 — Claude Haiku)")
    print(f"  Docket: {docket_id}")
    print(f"  Organic target: {n_organic}")
    print(f"  Campaigns: {len(CAMPAIGNS)} ({sum(c['size'] for c in CAMPAIGNS)} comments)")
    print(f"{'='*60}\n")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Phase 1: persona bank
    personas = build_persona_bank(client, n=n_personas, force=regen_personas)
    if not personas:
        raise RuntimeError("Failed to generate persona bank")

    # Phase 2: organic comments
    organic = gen_organic_batch(client, personas, n_organic)
    print(f"  Got {len(organic)} organic comments")

    # Phase 3: campaign comments
    campaign_outputs = []
    for camp in CAMPAIGNS:
        variants = gen_campaign(client, camp)
        campaign_outputs.append({"campaign": camp, "variants": variants})

    # Phase 4: write to DB
    print(f"\n  Writing to database...")
    conn = init_db(db_path)
    conn.execute("DELETE FROM comments WHERE docket_id = ?", (docket_id,))
    conn.execute("DELETE FROM embeddings WHERE comment_id IN (SELECT id FROM comments WHERE docket_id = ?)", (docket_id,))
    conn.execute("DELETE FROM analysis_runs WHERE docket_id = ?", (docket_id,))
    conn.commit()

    rng = random.Random(42)
    comment_idx = 0
    ground_truth = {}

    # Organic
    for c in organic:
        first, last, city, state = _gen_metadata(rng, persona=c.get("persona"))
        ts = base_time + timedelta(seconds=rng.uniform(0, 60 * 86400))
        cid = f"{docket_id}-{comment_idx:06d}"
        ground_truth[cid] = "organic"
        upsert_comment(conn, {
            "id": cid, "docket_id": docket_id, "document_id": "",
            "text": c["text"], "title": f"Comment from {first} {last}",
            "submitter_first": first, "submitter_last": last,
            "organization": "", "city": city, "state_prov": state,
            "posted_date": ts.isoformat(), "receive_date": ts.isoformat(),
            "tracking_nbr": "", "withdrawn": 0,
        })
        comment_idx += 1

    # Campaigns
    for co in campaign_outputs:
        camp = co["campaign"]
        variants = co["variants"]
        burst_start = base_time + timedelta(days=camp["burst_offset_days"], hours=camp["burst_hour"])
        for variant_text in variants:
            force_state = camp["geo_concentration"][:2].upper() if camp.get("geo_concentration") else None
            if force_state and rng.random() < 0.8:
                first, last, city, state = _gen_metadata(rng, force_state=force_state)
            else:
                first, last, city, state = _gen_metadata(rng)
            timestamp = burst_start + timedelta(seconds=rng.uniform(0, camp["burst_window_minutes"] * 60))
            cid = f"{docket_id}-{comment_idx:06d}"
            ground_truth[cid] = camp["id"]
            upsert_comment(conn, {
                "id": cid, "docket_id": docket_id, "document_id": "",
                "text": variant_text,
                "title": f"Comment from {first} {last}",
                "submitter_first": first, "submitter_last": last,
                "organization": camp["lobbying_org"] or "",
                "city": city, "state_prov": state,
                "posted_date": timestamp.isoformat(), "receive_date": timestamp.isoformat(),
                "tracking_nbr": "", "withdrawn": 0,
            })
            comment_idx += 1

    conn.commit()

    # Save ground truth for validation
    gt_path = os.path.join(os.path.dirname(__file__), "data", f"{docket_id}_ground_truth.json")
    with open(gt_path, "w") as f:
        json.dump(ground_truth, f, indent=2)

    print(f"\n  Total comments: {comment_idx}")
    print(f"  Organic: {len(organic)}")
    print(f"  Campaign comments: {comment_idx - len(organic)}")
    print(f"  Ground truth saved to: {gt_path}")
    print(f"{'='*60}\n")
    conn.close()
    return ground_truth


# ─── VALIDATION HARNESS ───────────────────────────────────────────
def validate_synthetic_corpus(docket_id=SYNTHETIC_DOCKET, db_path=DB_PATH):
    """Verify that the generated corpus separates cleanly under UMAP+HDBSCAN.
    Computes ARI, NMI, homogeneity, and per-class fragmentation stats.
    """
    import numpy as np
    from sklearn.metrics import (
        adjusted_rand_score, normalized_mutual_info_score,
        homogeneity_score, completeness_score, v_measure_score,
    )
    from collections import Counter
    from analysis.embedding import load_encoder, embed_comments
    from analysis.clustering import run_clustering

    print(f"\n{'='*60}")
    print(f"  VALIDATING SYNTHETIC CORPUS")
    print(f"{'='*60}")

    gt_path = os.path.join(os.path.dirname(__file__), "data", f"{docket_id}_ground_truth.json")
    if not os.path.exists(gt_path):
        print(f"  No ground truth file found at {gt_path}")
        return None
    with open(gt_path) as f:
        ground_truth = json.load(f)

    conn = init_db(db_path)
    encoder = load_encoder()
    ids, embeddings = embed_comments(conn, docket_id, encoder)

    if len(ids) == 0:
        print("  No embeddings found")
        return None

    cluster_result = run_clustering(embeddings)
    pred_labels = cluster_result["labels"]

    label_map = {}
    next_label = 0
    true_labels = []
    for cid in ids:
        gt = ground_truth.get(cid, "unknown")
        if gt not in label_map:
            label_map[gt] = next_label
            next_label += 1
        true_labels.append(label_map[gt])
    true_labels = np.array(true_labels)
    pred_labels = np.array(pred_labels)

    # Metrics — exclude noise (-1) to fairly evaluate clustering quality
    nonnoise = pred_labels != -1
    ari = adjusted_rand_score(true_labels[nonnoise], pred_labels[nonnoise])
    nmi = normalized_mutual_info_score(true_labels[nonnoise], pred_labels[nonnoise])
    homog = homogeneity_score(true_labels[nonnoise], pred_labels[nonnoise])
    comp = completeness_score(true_labels[nonnoise], pred_labels[nonnoise])
    vmeas = v_measure_score(true_labels[nonnoise], pred_labels[nonnoise])

    # Per-class fragmentation stats
    print(f"\n  Per-class fragmentation:")
    for gt_class, lbl in label_map.items():
        mask = true_labels == lbl
        n = mask.sum()
        pred_in_class = pred_labels[mask]
        cnt = Counter(pred_in_class.tolist())
        n_predicted_clusters = len([c for c in cnt if c != -1])
        n_in_noise = cnt.get(-1, 0)
        n_in_clusters = n - n_in_noise
        # Top 3 predicted clusters
        top3 = cnt.most_common(3)
        top3_str = ", ".join(f"#{c}({n_})" for c, n_ in top3)
        print(f"    {gt_class:30} n={n:4}  fragments={n_predicted_clusters:3}  noise={n_in_noise:3}  top: {top3_str}")

    # Per-cluster purity (the right metric for fragmented detection)
    print(f"\n  Per-cluster purity (top 10 by size):")
    cluster_sizes = Counter(pred_labels[pred_labels != -1].tolist())
    for cl, size in cluster_sizes.most_common(10):
        members_idx = np.where(pred_labels == cl)[0]
        gt_in_cluster = Counter(true_labels[members_idx].tolist())
        top_class, top_n = gt_in_cluster.most_common(1)[0]
        # Reverse map int → class name
        class_name = next(k for k, v in label_map.items() if v == top_class)
        purity = top_n / size
        print(f"    cluster {cl:5}  n={size:4}  purity={purity:.2%}  top class: {class_name}")

    print(f"\n  Aggregate metrics:")
    print(f"    ARI:           {ari:.4f}")
    print(f"    NMI:           {nmi:.4f}")
    print(f"    Homogeneity:   {homog:.4f}  (each cluster contains one true class)")
    print(f"    Completeness:  {comp:.4f}  (each true class lives in one cluster)")
    print(f"    V-measure:     {vmeas:.4f}")
    print(f"    HDBSCAN clusters: {cluster_result['n_clusters']}")
    print(f"    HDBSCAN noise:    {cluster_result['noise_count']}")
    print(f"    DBCV:             {cluster_result['validity']:.4f}")

    # Homogeneity is the right metric for fragmented-but-pure clusters
    if homog > 0.85:
        print(f"\n  ✅ Homogeneity > 0.85 — clusters are pure (campaigns may fragment but never mix)")
    elif homog > 0.7:
        print(f"\n  ⚠️  Homogeneity {homog:.2f} — mostly pure")
    else:
        print(f"\n  ❌ Homogeneity {homog:.2f} — clusters are mixing classes")

    print(f"{'='*60}\n")
    conn.close()
    return {
        "ari": float(ari), "nmi": float(nmi),
        "homogeneity": float(homog), "completeness": float(comp), "v_measure": float(vmeas),
        "n_clusters": cluster_result["n_clusters"],
    }


def get_ground_truth():
    return [{"id": c["id"], "label": c["label"], "size": c["size"]} for c in CAMPAIGNS]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n_organic", type=int, default=400)
    parser.add_argument("--n_personas", type=int, default=150)
    parser.add_argument("--db_path", default=DB_PATH)
    parser.add_argument("--docket_id", default=SYNTHETIC_DOCKET)
    parser.add_argument("--regen_personas", action="store_true")
    parser.add_argument("--validate_only", action="store_true")
    args = parser.parse_args()

    if args.validate_only:
        validate_synthetic_corpus(docket_id=args.docket_id, db_path=args.db_path)
    else:
        generate_synthetic_docket(
            n_organic=args.n_organic,
            db_path=args.db_path,
            docket_id=args.docket_id,
            n_personas=args.n_personas,
            regen_personas=args.regen_personas,
        )
        validate_synthetic_corpus(docket_id=args.docket_id, db_path=args.db_path)
