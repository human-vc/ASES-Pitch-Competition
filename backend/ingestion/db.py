import sqlite3
import json
import numpy as np
from datetime import datetime


def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            docket_id TEXT NOT NULL,
            document_id TEXT,
            text TEXT,
            title TEXT,
            submitter_first TEXT,
            submitter_last TEXT,
            organization TEXT,
            city TEXT,
            state_prov TEXT,
            posted_date TEXT,
            receive_date TEXT,
            tracking_nbr TEXT,
            withdrawn INTEGER DEFAULT 0,
            ingested_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            comment_id TEXT PRIMARY KEY REFERENCES comments(id),
            embedding BLOB
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS analysis_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            docket_id TEXT NOT NULL,
            run_at TEXT,
            n_comments INTEGER,
            n_clusters INTEGER,
            n_campaigns INTEGER,
            params_json TEXT,
            results_json TEXT
        )
    """)
    # Cross-docket fingerprint storage — for matching campaigns across dockets over time
    conn.execute("""
        CREATE TABLE IF NOT EXISTS argument_fingerprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            docket_id TEXT NOT NULL,
            cluster_id INTEGER,
            n_comments INTEGER,
            position TEXT,
            stance_summary TEXT,
            claims_json TEXT,
            premise_centroid BLOB,
            argument_hash TEXT,
            campaign_score REAL,
            created_at TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_docket ON comments(docket_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fingerprints_docket ON argument_fingerprints(docket_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fingerprints_hash ON argument_fingerprints(argument_hash)")
    conn.commit()
    return conn


def upsert_comment(conn, c):
    conn.execute("""
        INSERT OR IGNORE INTO comments
        (id, docket_id, document_id, text, title,
         submitter_first, submitter_last, organization,
         city, state_prov, posted_date, receive_date,
         tracking_nbr, withdrawn, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        c["id"], c["docket_id"], c.get("document_id"),
        c.get("text"), c.get("title"),
        c.get("submitter_first"), c.get("submitter_last"),
        c.get("organization"), c.get("city"), c.get("state_prov"),
        c.get("posted_date"), c.get("receive_date"),
        c.get("tracking_nbr"), c.get("withdrawn", 0),
        datetime.utcnow().isoformat()
    ))


def get_comment_ids(conn, docket_id):
    rows = conn.execute(
        "SELECT id FROM comments WHERE docket_id = ?", (docket_id,)
    ).fetchall()
    return {r[0] for r in rows}


def get_comments(conn, docket_id, min_text_len=30):
    """Returns comments with non-trivial text (filters out 'See Attached')."""
    cols = "id, text, posted_date, submitter_first, submitter_last, organization, city, state_prov"
    rows = conn.execute(
        f"""SELECT {cols} FROM comments
            WHERE docket_id = ?
              AND text IS NOT NULL
              AND length(text) >= ?
              AND lower(text) NOT IN ('see attached', 'see attachment', 'see attached file')""",
        (docket_id, min_text_len)
    ).fetchall()
    keys = [c.strip() for c in cols.split(",")]
    return [dict(zip(keys, r)) for r in rows]


def store_embeddings(conn, comment_ids, embeddings):
    data = [(cid, emb.astype(np.float32).tobytes())
            for cid, emb in zip(comment_ids, embeddings)]
    conn.executemany(
        "INSERT OR REPLACE INTO embeddings (comment_id, embedding) VALUES (?, ?)",
        data
    )
    conn.commit()


def load_embeddings(conn, docket_id):
    rows = conn.execute("""
        SELECT e.comment_id, e.embedding
        FROM embeddings e JOIN comments c ON e.comment_id = c.id
        WHERE c.docket_id = ? AND c.text IS NOT NULL AND c.text != ''
    """, (docket_id,)).fetchall()
    if not rows:
        return [], np.array([])
    ids = [r[0] for r in rows]
    vecs = np.array([np.frombuffer(r[1], dtype=np.float32) for r in rows])
    return ids, vecs


def get_embedded_ids(conn, docket_id):
    rows = conn.execute("""
        SELECT e.comment_id FROM embeddings e
        JOIN comments c ON e.comment_id = c.id
        WHERE c.docket_id = ?
    """, (docket_id,)).fetchall()
    return {r[0] for r in rows}


def _json_safe(obj):
    """Recursively convert numpy types to Python native for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(x) for x in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    return obj


def store_analysis_run(conn, run_dict):
    conn.execute("""
        INSERT INTO analysis_runs
        (docket_id, run_at, n_comments, n_clusters, n_campaigns, params_json, results_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        run_dict["docket_id"],
        datetime.utcnow().isoformat(),
        run_dict["n_comments"],
        run_dict["n_clusters"],
        run_dict["n_campaigns"],
        json.dumps(_json_safe(run_dict.get("params", {}))),
        json.dumps(_json_safe(run_dict.get("results", {})))
    ))
    conn.commit()


def get_latest_run(conn, docket_id):
    row = conn.execute("""
        SELECT results_json FROM analysis_runs
        WHERE docket_id = ? ORDER BY id DESC LIMIT 1
    """, (docket_id,)).fetchone()
    if row:
        return json.loads(row[0])
    return None


def store_fingerprint(conn, docket_id, cluster_id, fp):
    """Store an argument fingerprint for cross-docket matching."""
    centroid = fp.get("premise_centroid")
    if centroid is not None:
        centroid = np.asarray(centroid, dtype=np.float32).tobytes()
    conn.execute("""
        INSERT INTO argument_fingerprints
        (docket_id, cluster_id, n_comments, position, stance_summary,
         claims_json, premise_centroid, argument_hash, campaign_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        docket_id, cluster_id, fp.get("n_comments"),
        fp.get("position"), fp.get("stance_summary"),
        json.dumps(fp.get("claims", [])),
        centroid,
        fp.get("argument_hash"),
        fp.get("campaign_score", 0.0),
        datetime.utcnow().isoformat(),
    ))
    conn.commit()


def find_similar_fingerprints(conn, claims_hash, exclude_docket=None):
    """Look up cross-docket matches by argument hash. Future: add semantic matching."""
    query = "SELECT docket_id, cluster_id, n_comments, claims_json FROM argument_fingerprints WHERE argument_hash = ?"
    params = [claims_hash]
    if exclude_docket:
        query += " AND docket_id != ?"
        params.append(exclude_docket)
    rows = conn.execute(query, params).fetchall()
    return [
        {"docket_id": r[0], "cluster_id": r[1], "n_comments": r[2], "claims": json.loads(r[3])}
        for r in rows
    ]
