import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from config import DB_PATH
from ingestion.db import init_db, get_latest_run
from api.models import DocketSummary, ClusterInfo, TimelineBucket, AnalysisResponse

app = FastAPI(title="DocketLens API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_conn():
    return init_db(DB_PATH)


def _get_results(docket_id):
    conn = _get_conn()
    results = get_latest_run(conn, docket_id)
    conn.close()
    if not results:
        raise HTTPException(404, f"No analysis found for {docket_id}")
    return results


@app.get("/dockets")
def list_dockets():
    conn = _get_conn()
    rows = conn.execute(
        "SELECT DISTINCT docket_id, n_comments, n_clusters, n_campaigns FROM analysis_runs ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return [
        {"docket_id": r[0], "n_comments": r[1], "n_clusters": r[2], "n_campaigns": r[3]}
        for r in rows
    ]


@app.get("/dockets/{docket_id}/summary")
def docket_summary(docket_id: str):
    r = _get_results(docket_id)
    return DocketSummary(
        docket_id=r["docket_id"],
        n_comments=r["n_comments"],
        n_clusters=r["n_clusters"],
        n_campaigns=r["n_campaigns"],
        n_manufactured=r["n_manufactured"],
        n_unique_voices=r["n_unique_voices"],
        manufactured_pct=r["manufactured_pct"],
    )


@app.get("/dockets/{docket_id}/clusters")
def docket_clusters(docket_id: str):
    r = _get_results(docket_id)
    return [ClusterInfo(**cl) for cl in r["clusters"]]


@app.get("/dockets/{docket_id}/clusters/{cluster_id}")
def cluster_detail(docket_id: str, cluster_id: int):
    r = _get_results(docket_id)
    for cl in r["clusters"]:
        if cl["cluster_id"] == cluster_id:
            return ClusterInfo(**cl)
    raise HTTPException(404, f"Cluster {cluster_id} not found")


@app.get("/dockets/{docket_id}/timeline")
def docket_timeline(docket_id: str):
    r = _get_results(docket_id)
    return [TimelineBucket(**t) for t in r.get("timeline", [])]


@app.get("/dockets/{docket_id}/full")
def full_analysis(docket_id: str):
    r = _get_results(docket_id)
    return r
