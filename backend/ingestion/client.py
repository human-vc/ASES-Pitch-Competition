import time
import html
import re
import requests
from collections import deque
from config import (
    REGS_API_BASE, REGS_API_KEY, PAGE_SIZE,
    RATE_LIMIT_PER_HOUR, BACKOFF_BASE, MAX_RETRIES
)
from ingestion.db import upsert_comment, get_comment_ids


class RegsClient:
    def __init__(self, api_key=REGS_API_KEY):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers["X-Api-Key"] = api_key
        self.session.headers["Content-Type"] = "application/vnd.api+json"
        self._req_times = deque()

    def _throttle(self):
        now = time.time()
        # Prune requests older than 1 hour
        while self._req_times and self._req_times[0] < now - 3600:
            self._req_times.popleft()
        if len(self._req_times) >= RATE_LIMIT_PER_HOUR:
            wait = self._req_times[0] + 3600 - now + 1
            print(f"  [rate limit] sleeping {wait:.0f}s...")
            time.sleep(wait)
        self._req_times.append(time.time())

    def _request(self, endpoint, params=None):
        url = f"{REGS_API_BASE}{endpoint}"
        for attempt in range(MAX_RETRIES):
            self._throttle()
            try:
                resp = self.session.get(url, params=params, timeout=30)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 429:
                    wait = BACKOFF_BASE ** (attempt + 1)
                    print(f"  [429] rate limited, retrying in {wait:.0f}s...")
                    time.sleep(wait)
                elif resp.status_code >= 500:
                    wait = BACKOFF_BASE ** attempt
                    print(f"  [{resp.status_code}] server error, retrying in {wait:.0f}s...")
                    time.sleep(wait)
                else:
                    print(f"  [{resp.status_code}] {resp.text[:200]}")
                    return None
            except requests.RequestException as e:
                wait = BACKOFF_BASE ** attempt
                print(f"  [error] {e}, retrying in {wait:.0f}s...")
                time.sleep(wait)
        print(f"  [failed] {endpoint} after {MAX_RETRIES} retries")
        return None

    def get_docket(self, docket_id):
        data = self._request(f"/dockets/{docket_id}")
        if data:
            return data.get("data", {}).get("attributes", {})
        return None

    def list_comments(self, docket_id, max_comments=None):
        """
        List comment IDs + metadata for a docket.
        Handles the 5000-result cap by date-windowing.
        Yields comment stub dicts.
        """
        count = 0
        last_date = None

        while True:
            page = 1
            page_results = 0

            while True:
                params = {
                    "filter[docketId]": docket_id,
                    "page[size]": PAGE_SIZE,
                    "page[number]": page,
                    "sort": "postedDate",
                }
                if last_date:
                    params["filter[postedDate][ge]"] = last_date

                data = self._request("/comments", params)
                if not data or "data" not in data:
                    return

                items = data["data"]
                if not items:
                    return

                for item in items:
                    attrs = item.get("attributes", {})
                    stub = {
                        "id": item["id"],
                        "posted_date": attrs.get("postedDate"),
                        "title": attrs.get("title"),
                    }
                    yield stub
                    count += 1
                    page_results += 1
                    last_posted = attrs.get("postedDate")

                    if max_comments and count >= max_comments:
                        return

                # Check if there are more pages
                meta = data.get("meta", {})
                total_elements = meta.get("totalElements", 0)

                if page * PAGE_SIZE >= min(total_elements, 5000):
                    break
                page += 1

            # If we got exactly 5000 results, window forward
            if page_results >= 5000 and last_posted:
                last_date = last_posted
                page_results = 0
            else:
                break

    def get_comment_detail(self, comment_id):
        data = self._request(f"/comments/{comment_id}")
        if not data or "data" not in data:
            return None
        attrs = data["data"].get("attributes", {})
        addr = attrs.get("address", {}) or {}
        # Clean text: decode HTML entities, strip tags
        raw_text = attrs.get("comment", "") or ""
        clean_text = html.unescape(raw_text)
        clean_text = re.sub(r"<[^>]+>", " ", clean_text)
        clean_text = re.sub(r"\s+", " ", clean_text).strip()
        return {
            "id": data["data"]["id"],
            "docket_id": attrs.get("docketId", ""),
            "document_id": attrs.get("commentOnDocumentId", ""),
            "text": clean_text,
            "title": attrs.get("title", ""),
            "submitter_first": attrs.get("firstName", ""),
            "submitter_last": attrs.get("lastName", ""),
            "organization": attrs.get("organization", ""),
            "city": addr.get("city", ""),
            "state_prov": addr.get("stateProvinceRegion", ""),
            "posted_date": attrs.get("postedDate", ""),
            "receive_date": attrs.get("receiveDate", ""),
            "tracking_nbr": attrs.get("trackingNbr", ""),
            "withdrawn": 1 if attrs.get("withdrawn") else 0,
        }

    def ingest_docket(self, docket_id, conn, max_comments=None):
        print(f"\n{'='*60}")
        print(f"  INGESTING: {docket_id}")
        print(f"{'='*60}")

        existing = get_comment_ids(conn, docket_id)
        print(f"  Already have {len(existing)} comments cached")

        # Phase 1: list comment IDs
        print(f"  Listing comments...")
        stubs = list(self.list_comments(docket_id, max_comments))
        new_ids = [s["id"] for s in stubs if s["id"] not in existing]
        print(f"  Found {len(stubs)} total, {len(new_ids)} new to fetch")

        if not new_ids:
            print("  Nothing new to ingest.")
            return

        # Phase 2: fetch full text for new comments
        for i, cid in enumerate(new_ids):
            if i % 50 == 0:
                print(f"  Fetching details... {i}/{len(new_ids)}")
            detail = self.get_comment_detail(cid)
            if detail:
                upsert_comment(conn, detail)
                if i % 100 == 0:
                    conn.commit()

        conn.commit()
        total = len(existing) + len(new_ids)
        print(f"  Done. {total} total comments for {docket_id}")
        print(f"{'='*60}\n")
