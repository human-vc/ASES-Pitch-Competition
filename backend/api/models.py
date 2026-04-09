from pydantic import BaseModel


class DocketSummary(BaseModel):
    docket_id: str
    n_comments: int
    n_clusters: int
    n_campaigns: int
    n_manufactured: int
    n_unique_voices: int
    manufactured_pct: float


class ClusterInfo(BaseModel):
    cluster_id: int
    n_comments: int
    classification: str
    campaign_score: float
    score_breakdown: dict
    center_x: float
    center_y: float
    radius: float
    sample_comments: list
    style: dict
    compression: dict
    duplicates: dict
    temporal: dict
    fingerprint: dict


class TimelineBucket(BaseModel):
    timestamp: str
    count: int
    is_burst: bool


class AnalysisResponse(BaseModel):
    docket: DocketSummary
    clusters: list[ClusterInfo]
    timeline: list[TimelineBucket]
