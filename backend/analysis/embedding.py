import time
import numpy as np
import voyageai
from config import VOYAGE_API_KEY, EMBED_MODEL
from ingestion.db import get_comments, get_embedded_ids, store_embeddings, load_embeddings

# Voyage limits (paid tier): batch endpoint accepts up to 1000 texts
# Or up to 120K tokens total. We use a conservative chunk.
MAX_BATCH_SIZE = 128             # voyage hard cap is 128 for paid tier
MAX_TOKENS_PER_BATCH = 25000     # well below 120K cap
SECONDS_BETWEEN_REQUESTS = 0.5
MAX_CHARS_PER_COMMENT = 4000


def load_encoder(model_name=EMBED_MODEL):
    print(f"  Loading Voyage encoder: {model_name}")
    if not VOYAGE_API_KEY:
        raise RuntimeError("VOYAGE_API_KEY not set")
    return voyageai.Client(api_key=VOYAGE_API_KEY)


def _estimate_tokens(text):
    """Rough token estimate: ~4 chars per token for English."""
    return max(1, len(text) // 4)


def _build_token_aware_batches(items, max_tokens=MAX_TOKENS_PER_BATCH, max_batch=MAX_BATCH_SIZE):
    """Group comments into batches that stay under the token budget AND batch count cap."""
    batches = []
    current = []
    current_tokens = 0
    for item in items:
        text = item["text"][:MAX_CHARS_PER_COMMENT]
        tokens = _estimate_tokens(text)
        if (current_tokens + tokens > max_tokens or len(current) >= max_batch) and current:
            batches.append(current)
            current = []
            current_tokens = 0
        current.append({"id": item["id"], "text": text, "tokens": tokens})
        current_tokens += tokens
    if current:
        batches.append(current)
    return batches


def _embed_batch(client, batch, model=EMBED_MODEL, max_retries=5):
    texts = [b["text"] for b in batch]
    last_err = None
    for attempt in range(max_retries):
        try:
            result = client.embed(
                texts,
                model=model,
                input_type="document",
                truncation=True,
            )
            return np.array(result.embeddings, dtype=np.float32)
        except Exception as e:
            last_err = e
            msg = str(e)
            wait = min(30, 1.5 ** attempt + 1)
            print(f"  [retry {attempt+1}] {type(e).__name__}: {msg[:120]}, sleeping {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"Failed to embed batch after {max_retries} retries: {last_err}")


def embed_comments(conn, docket_id, encoder=None, batch_size=None):
    if encoder is None:
        encoder = load_encoder()

    comments = get_comments(conn, docket_id)
    embedded_ids = get_embedded_ids(conn, docket_id)
    to_embed = [c for c in comments if c["id"] not in embedded_ids]

    print(f"\n  EMBEDDING: {len(to_embed)} new comments ({len(embedded_ids)} cached)")

    if to_embed:
        batches = _build_token_aware_batches(to_embed)
        print(f"  {len(batches)} batches (≤{MAX_TOKENS_PER_BATCH} tokens each)")

        all_vecs = []
        all_ids = []
        last_request_time = 0

        for bi, batch in enumerate(batches):
            # Pace requests to respect rate limit
            elapsed = time.time() - last_request_time
            if elapsed < SECONDS_BETWEEN_REQUESTS and bi > 0:
                wait = SECONDS_BETWEEN_REQUESTS - elapsed
                print(f"    pacing... sleeping {wait:.0f}s")
                time.sleep(wait)

            print(f"    batch {bi+1}/{len(batches)}: {len(batch)} comments, ~{sum(b['tokens'] for b in batch)} tok")
            vecs = _embed_batch(encoder, batch)
            last_request_time = time.time()

            # L2 normalize
            vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12)
            all_vecs.append(vecs)
            all_ids.extend([b["id"] for b in batch])

            # Persist after each batch (so we don't lose progress on failure)
            store_embeddings(conn, [b["id"] for b in batch], vecs)

        embeddings = np.vstack(all_vecs)
        print(f"  Stored {len(all_ids)} embeddings (dim={embeddings.shape[1]})")

    ids, vecs = load_embeddings(conn, docket_id)
    print(f"  Total embeddings for {docket_id}: {len(ids)}")
    return ids, vecs
