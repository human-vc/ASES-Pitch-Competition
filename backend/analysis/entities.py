"""
Entity resolution: cross-reference commenter organizations against known
lobbying entities, trade associations, and corporate affiliates.

Note: OpenSecrets API was discontinued April 2025. We use a built-in registry
of known regulatory affairs entities + fuzzy matching. Bulk OpenSecrets data
can be loaded later via the load_opensecrets_bulk() function.
"""

import re
from collections import Counter
from difflib import SequenceMatcher

# Known lobbying entities and trade associations (financial services focus + general)
# This is the seed registry; expand via OpenSecrets bulk data
KNOWN_ENTITIES = {
    # Financial services trade associations (our beachhead)
    "american bankers association": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "credit union national association": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "cuna": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "national association of federal credit unions": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "consumer bankers association": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "high"},
    "independent community bankers of america": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "icba": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "financial services forum": {"sector": "banking", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "investment company institute": {"sector": "asset_mgmt", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "ici": {"sector": "asset_mgmt", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "sifma": {"sector": "securities", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "securities industry and financial markets association": {"sector": "securities", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "mortgage bankers association": {"sector": "mortgage", "type": "trade_assoc", "lobby_intensity": "high"},
    "national association of realtors": {"sector": "real_estate", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "national association of mortgage brokers": {"sector": "mortgage", "type": "trade_assoc", "lobby_intensity": "high"},
    "american financial services association": {"sector": "finance", "type": "trade_assoc", "lobby_intensity": "high"},
    "consumer data industry association": {"sector": "data", "type": "trade_assoc", "lobby_intensity": "high"},
    "national consumer law center": {"sector": "consumer_advocacy", "type": "advocacy", "lobby_intensity": "high"},
    "americans for financial reform": {"sector": "consumer_advocacy", "type": "advocacy", "lobby_intensity": "high"},
    "center for responsible lending": {"sector": "consumer_advocacy", "type": "advocacy", "lobby_intensity": "high"},
    "consumer federation of america": {"sector": "consumer_advocacy", "type": "advocacy", "lobby_intensity": "high"},
    # Energy / Environment
    "american petroleum institute": {"sector": "energy", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "api": {"sector": "energy", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "edison electric institute": {"sector": "energy", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "natural resources defense council": {"sector": "environment", "type": "advocacy", "lobby_intensity": "high"},
    "nrdc": {"sector": "environment", "type": "advocacy", "lobby_intensity": "high"},
    "sierra club": {"sector": "environment", "type": "advocacy", "lobby_intensity": "high"},
    "environmental defense fund": {"sector": "environment", "type": "advocacy", "lobby_intensity": "high"},
    # Healthcare
    "phrma": {"sector": "pharma", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "pharmaceutical research and manufacturers of america": {"sector": "pharma", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "american medical association": {"sector": "healthcare", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "ama": {"sector": "healthcare", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "american hospital association": {"sector": "healthcare", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "aha": {"sector": "healthcare", "type": "trade_assoc", "lobby_intensity": "very_high"},
    # Tech
    "computer and communications industry association": {"sector": "tech", "type": "trade_assoc", "lobby_intensity": "high"},
    "ccia": {"sector": "tech", "type": "trade_assoc", "lobby_intensity": "high"},
    "internet association": {"sector": "tech", "type": "trade_assoc", "lobby_intensity": "high"},
    "techfreedom": {"sector": "tech", "type": "advocacy", "lobby_intensity": "medium"},
    # General lobbying
    "us chamber of commerce": {"sector": "general", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "chamber of commerce of the united states": {"sector": "general", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "national association of manufacturers": {"sector": "general", "type": "trade_assoc", "lobby_intensity": "very_high"},
    "nam": {"sector": "general", "type": "trade_assoc", "lobby_intensity": "very_high"},
}


def _normalize_org(name):
    if not name:
        return ""
    name = name.lower().strip()
    # Strip common suffixes
    name = re.sub(r"\b(inc|llc|llp|corp|corporation|ltd|limited|co|company|the)\b", "", name)
    name = re.sub(r"[^a-z0-9\s]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _fuzzy_match(query, threshold=0.85):
    """Fuzzy match an organization name against the known registry."""
    if not query:
        return None
    norm = _normalize_org(query)
    if not norm:
        return None

    # Exact match first
    if norm in KNOWN_ENTITIES:
        return norm, 1.0

    # Substring match (catches abbreviations within longer names)
    for known in KNOWN_ENTITIES:
        if known in norm or norm in known:
            return known, 0.95

    # Fuzzy match
    best_match, best_score = None, 0
    for known in KNOWN_ENTITIES:
        score = SequenceMatcher(None, norm, known).ratio()
        if score > best_score:
            best_score = score
            best_match = known

    if best_score >= threshold:
        return best_match, best_score
    return None


def resolve_entities(comments):
    """
    Resolve commenter organizations against the known entity registry.
    Returns dict[comment_id -> entity_info] for matched comments.
    """
    matches = {}
    for c in comments:
        org = (c.get("organization") or "").strip()
        if not org:
            continue
        match = _fuzzy_match(org)
        if match:
            entity, score = match
            info = KNOWN_ENTITIES[entity]
            matches[c["id"]] = {
                "raw": org,
                "matched_entity": entity,
                "match_score": round(score, 3),
                "sector": info["sector"],
                "type": info["type"],
                "lobby_intensity": info["lobby_intensity"],
            }
    return matches


def cluster_entity_concentration(comments, labels, entity_matches):
    """
    For each cluster, compute entity concentration metrics:
    - How many distinct entities are represented
    - Most common entity affiliation
    - Fraction tied to known lobbying organizations
    """
    results = {}
    for cl in set(labels.tolist()) if hasattr(labels, "tolist") else set(labels):
        if cl == -1:
            continue
        member_idx = [i for i, l in enumerate(labels) if l == cl]
        if len(member_idx) < 3:
            continue

        members = [comments[i] for i in member_idx]
        n_total = len(members)

        # Count distinct entities
        entity_counts = Counter()
        n_matched = 0
        sector_counts = Counter()
        intensity_counts = Counter()

        for m in members:
            mid = m["id"]
            if mid in entity_matches:
                e = entity_matches[mid]
                entity_counts[e["matched_entity"]] += 1
                sector_counts[e["sector"]] += 1
                intensity_counts[e["lobby_intensity"]] += 1
                n_matched += 1

        match_rate = n_matched / n_total

        if not entity_counts:
            results[int(cl)] = {
                "n_matched": 0,
                "match_rate": 0.0,
                "top_entity": None,
                "concentration_score": 0.0,
                "note": "no recognized entities",
            }
            continue

        top_entity, top_count = entity_counts.most_common(1)[0]
        top_pct = top_count / n_matched

        # Concentration: high if a single entity dominates
        concentration_score = top_pct

        results[int(cl)] = {
            "n_matched": n_matched,
            "match_rate": round(match_rate, 3),
            "top_entity": top_entity,
            "top_entity_pct": round(top_pct, 3),
            "n_distinct_entities": len(entity_counts),
            "concentration_score": round(concentration_score, 4),
            "sector_breakdown": dict(sector_counts),
            "high_intensity_lobbying_pct": round(
                (intensity_counts.get("very_high", 0) + intensity_counts.get("high", 0)) / max(1, n_matched), 3
            ),
        }
    return results


def load_opensecrets_bulk(path):
    """Stub: load OpenSecrets bulk CSV data into the registry. Future work."""
    # TODO: parse OpenSecrets bulk data files (lobby_lobbyist.csv, lob_indus.csv)
    print(f"  [todo] load_opensecrets_bulk: {path}")
    return KNOWN_ENTITIES
