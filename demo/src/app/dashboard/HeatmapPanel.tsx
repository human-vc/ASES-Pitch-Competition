"use client";

import { useMemo } from "react";
import type { Cluster, DashboardData } from "./types";

interface Props {
  data: DashboardData;
  width: number;
  height: number;
  selectedCluster: number | null;
  onSelect: (id: number) => void;
}

const SIGNAL_COLS: { key: string; label: string; getter: (c: Cluster) => number }[] = [
  { key: "tcs", label: "TEMP", getter: (c) => c.temporal?.tcs ?? 0 },
  { key: "style", label: "STYL", getter: (c) => c.stylometric?.campaign_score ?? 0 },
  { key: "dup", label: "DUP", getter: (c) => c.duplicates?.dup_fraction ?? 0 },
  { key: "ai", label: "AI", getter: (c) => c.ai_detection?.ai_score ?? 0 },
  { key: "arg", label: "ARG", getter: (c) => c.argument_identity?.mean_identity ?? 0 },
  { key: "geo", label: "GEO", getter: (c) => c.geographic?.concentration_score ?? 0 },
  { key: "ent", label: "ENT", getter: (c) => c.entities?.match_rate ?? 0 },
  { key: "burst", label: "BURST", getter: (c) => Math.min(1, (c.temporal?.lambda_star ?? 0) / 200) },
  { key: "boxm", label: "BoxM", getter: (c) => Math.min(1, (c.stylometric?.chi_stat ?? 0) / 10000) },
  { key: "sim", label: "SIM", getter: (c) => c.duplicate_chain?.mean_pairwise_similarity ?? 0 },
  { key: "unan", label: "UNAN", getter: (c) => c.argument_identity?.position_unanimity ?? 0 },
  { key: "score", label: "SCORE", getter: (c) => c.campaign_score },
];

// Inferno-like color scale (amber friendly)
function colorScale(v: number): string {
  if (v <= 0) return "#0A0E17";
  if (v < 0.15) return "#1A0E0A";
  if (v < 0.3) return "#3D1F0A";
  if (v < 0.45) return "#7A3D08";
  if (v < 0.6) return "#B85F00";
  if (v < 0.75) return "#FF8C00";
  if (v < 0.9) return "#FF5722";
  return "#FF3B3B";
}

export default function HeatmapPanel({ data, width, height, selectedCluster, onSelect }: Props) {
  // Top 30 clusters by composite score
  const clusters = useMemo(
    () => [...data.clusters].sort((a, b) => b.campaign_score - a.campaign_score).slice(0, 30),
    [data]
  );

  const padTop = 28;
  const padLeft = 60;
  const padRight = 8;
  const padBottom = 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const colW = innerW / SIGNAL_COLS.length;
  const rowH = innerH / clusters.length;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="dl-svg">
      {/* Column headers */}
      {SIGNAL_COLS.map((col, i) => (
        <text
          key={col.key}
          x={padLeft + i * colW + colW / 2}
          y={padTop - 6}
          textAnchor="middle"
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fontWeight="600"
          fill="#B8860B"
        >
          {col.label}
        </text>
      ))}

      {/* Rows */}
      {clusters.map((c, ri) => (
        <g key={c.cluster_id}>
          {/* Row label */}
          <text
            x={padLeft - 4}
            y={padTop + ri * rowH + rowH / 2 + 2}
            textAnchor="end"
            fontSize="7"
            fontFamily="IBM Plex Mono, monospace"
            fontWeight={c.cluster_id === selectedCluster ? 700 : 400}
            fill={c.cluster_id === selectedCluster ? "#FFFFFF" : "#FFA028"}
          >
            #{c.cluster_id} ({c.n_comments * 8})
          </text>
          {/* Cells */}
          {SIGNAL_COLS.map((col, ci) => {
            const v = col.getter(c);
            return (
              <rect
                key={col.key}
                x={padLeft + ci * colW + 0.5}
                y={padTop + ri * rowH + 0.5}
                width={colW - 1}
                height={rowH - 1}
                fill={colorScale(v)}
                stroke={c.cluster_id === selectedCluster ? "#FFFFFF" : "transparent"}
                strokeWidth={c.cluster_id === selectedCluster ? 0.5 : 0}
                onClick={() => onSelect(c.cluster_id)}
                style={{ cursor: "pointer" }}
              >
                <title>
                  CLUS {c.cluster_id} · {col.label}: {v.toFixed(3)}
                </title>
              </rect>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
