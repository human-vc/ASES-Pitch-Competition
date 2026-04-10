// Data types for the DocketLens dashboard

export interface Cluster {
  cluster_id: number;
  n_comments: number;
  is_tree_campaign: boolean;
  classification: "campaign" | "uncertain" | "organic";
  campaign_score: number;
  score_breakdown: {
    duplicate: number;
    temporal_coupling: number;
    stylometric: number;
    argument_identity: number;
    ai_detection: number;
    paraphrase_reachable: number;
  };
  center_x: number;
  center_y: number;
  radius: number;
  sample_comments: string[];
  stylometric: {
    n_members: number;
    campaign_score: number;
    p_value: number;
    median_variance_ratio: number;
    chi_stat: number;
    std_ratio: number[];
    feature_names: string[];
  };
  temporal: {
    lambda_star?: number;
    p_analytic?: number;
    peak_count?: number;
    peak_expected?: number;
    peak_start?: string;
    peak_end?: string;
    window_minutes?: number;
    tcs?: number;
  };
  duplicates: {
    n_members?: number;
    n_duplicates?: number;
    dup_fraction?: number;
    largest_dup_group?: number;
  };
  duplicate_chain?: {
    n_total?: number;
    n_exact_dup?: number;
    n_unique_text?: number;
    largest_exact_group?: number;
    n_near_dup_members?: number;
    n_near_dup_groups?: number;
    mean_pairwise_similarity?: number;
    median_pairwise_similarity?: number;
    min_pairwise_similarity?: number;
    sophistication?: string;
  };
  geographic: {
    completeness?: number;
    n_states?: number;
    top_state?: string;
    top_state_pct?: number;
    concentration_score?: number;
    entropy_ratio?: number;
    kl_divergence?: number;
    confidence?: string;
    state_distribution?: Record<string, number>;
  };
  entities: {
    n_matched?: number;
    match_rate?: number;
    top_entity?: string;
    top_entity_pct?: number;
    n_distinct_entities?: number;
    concentration_score?: number;
    sector_breakdown?: Record<string, number>;
    high_intensity_lobbying_pct?: number;
  };
  argument_identity: {
    n_extracted?: number;
    mean_identity?: number;
    median_identity?: number;
    position_unanimity?: number;
    dominant_position?: string;
    top_premises?: string[];
    argument_hash?: string;
    stance_summary?: string;
  };
  ai_detection: {
    n_sampled?: number;
    mean_surprisal?: number;
    cluster_surprisal_std?: number;
    baseline_surprisal_std?: number;
    ai_score?: number;
    median_std_ratio?: number;
    interpretation?: string;
  };
  paraphrase_probe: Record<string, unknown>;
}

export interface TimelineBucket {
  timestamp: string;
  count: number;
  is_burst: boolean;
}

export interface Community {
  community_id: number;
  n_members: number;
  members: number[];
  edge_types: string[];
  internal_weight: number;
  density: number;
}

export interface CommentData {
  text: string;
  first: string;
  last: string;
  org: string;
  city: string;
  state: string;
  date: string;
  country?: string;
  country_name?: string;
}

export interface EntityInfo {
  sector: string;
  type: string;
  intensity: string;
  why: string;
  annual_lobby: string;
}

export interface DashboardData {
  docket_id: string;
  n_comments: number;
  n_clusters: number;
  n_campaigns: number;
  n_manufactured: number;
  n_unique_voices: number;
  manufactured_pct: number;
  validity: number;
  clusters: Cluster[];
  timeline: TimelineBucket[];
  communities: Community[];
  coordination_overlap: Array<{
    community_id: number;
    n_members: number;
    best_semantic_match: number;
    overlap: number;
  }>;
  coords_2d: number[][];
  comment_ids: string[];
  labels: number[];
  comments_data: Record<string, CommentData>;
  entity_registry?: Record<string, EntityInfo>;
  country_distribution?: Record<string, number>;
}
