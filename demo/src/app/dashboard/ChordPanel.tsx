"use client";

import { useMemo } from "react";
import { chord, ribbon } from "d3-chord";
import { arc as d3Arc } from "d3-shape";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
  width: number;
  height: number;
  selectedEntity?: string | null;
  onSelectEntity?: (e: string | null) => void;
}

const ENTITY_COLORS = [
  "#FF3B3B", "#FFA028", "#00B4D8", "#00D26A", "#C792EA",
  "#FFB800", "#F472B6", "#4FC3F7", "#FF8C42", "#A78BFA",
];

export default function ChordPanel({ data, width, height, selectedEntity, onSelectEntity }: Props) {
  const { matrix, entities } = useMemo(() => {
    // Find top entities by total comments
    const entCounts: Record<string, number> = {};
    Object.values(data.comments_data || {}).forEach((c) => {
      if (c?.org) entCounts[c.org] = (entCounts[c.org] || 0) + 1;
    });
    const topEnts = Object.entries(entCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map((e) => e[0]);

    if (topEnts.length < 2) {
      return { matrix: [], entities: [] };
    }

    // Build co-occurrence matrix: how often two entities appear in same cluster
    const m = topEnts.map(() => topEnts.map(() => 0));
    const idxMap = Object.fromEntries(topEnts.map((e, i) => [e, i]));

    // For each cluster, find which top entities appear in it
    data.clusters.forEach((cluster) => {
      const cid = cluster.cluster_id;
      const memberIds = data.comment_ids.filter((_, i) => data.labels[i] === cid);
      const orgsInCluster = new Set<string>();
      memberIds.forEach((id) => {
        const c = data.comments_data?.[id];
        if (c?.org && c.org in idxMap) orgsInCluster.add(c.org);
      });
      const orgList = Array.from(orgsInCluster);
      // Add co-occurrence between every pair (and self for the diagonal weight)
      orgList.forEach((a) => {
        const ai = idxMap[a];
        m[ai][ai] += 1; // self contribution
        orgList.forEach((b) => {
          if (a === b) return;
          const bi = idxMap[b];
          m[ai][bi] += 1;
        });
      });
    });

    return { matrix: m, entities: topEnts };
  }, [data]);

  if (entities.length < 2) {
    return (
      <div
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6B5D3F",
          fontSize: 10,
        }}
      >
        Insufficient entity data for chord diagram
      </div>
    );
  }

  // Shrink the ring so labels never run off the edge
  const padTop = 8;
  const padBottom = 8;
  const cy = (height - padTop - padBottom) / 2 + padTop;
  const cx = width / 2;
  const outerRadius = Math.min(width, height) / 2 - 56;
  const innerRadius = outerRadius - 6;

  const chordGen = chord().padAngle(0.04).sortSubgroups((a, b) => b - a);
  const chords = chordGen(matrix);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arcGen = d3Arc<any>().innerRadius(innerRadius).outerRadius(outerRadius);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ribbonGen: any = ribbon().radius(innerRadius);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="dl-svg"
      style={{ display: "block" }}
    >
      <g transform={`translate(${cx},${cy})`}>
        {/* Ribbons (connections) — dim those not touching the selected entity */}
        {chords.map((c, i) => {
          const color = ENTITY_COLORS[c.source.index % ENTITY_COLORS.length];
          const d = ribbonGen(c);
          const sel =
            selectedEntity != null
              ? entities[c.source.index] === selectedEntity ||
                entities[c.target.index] === selectedEntity
              : true;
          return (
            <path
              key={i}
              d={typeof d === "string" ? d : ""}
              fill={color}
              fillOpacity={sel ? 0.45 : 0.06}
              stroke={color}
              strokeOpacity={sel ? 0.7 : 0.1}
              strokeWidth={0.4}
            />
          );
        })}
        {/* Arcs (entity outer ring) — clickable */}
        {chords.groups.map((g, i) => {
          const color = ENTITY_COLORS[i % ENTITY_COLORS.length];
          const midAngle = (g.startAngle + g.endAngle) / 2 - Math.PI / 2;
          const labelR = outerRadius + 4;
          const lx = Math.cos(midAngle) * labelR;
          const ly = Math.sin(midAngle) * labelR;
          const ent = entities[i] || "";
          const isSel = selectedEntity === ent;
          // Truncate harder so labels never spill off the panel
          const short = ent.length > 13 ? ent.slice(0, 12) + "…" : ent;
          return (
            <g
              key={i}
              onClick={() => {
                if (onSelectEntity) onSelectEntity(isSel ? null : ent);
              }}
              style={{ cursor: onSelectEntity ? "pointer" : "default" }}
            >
              <path
                d={arcGen(g) || ""}
                fill={color}
                opacity={isSel ? 1 : selectedEntity ? 0.4 : 0.95}
                stroke={isSel ? "#FFFFFF" : "transparent"}
                strokeWidth={isSel ? 1 : 0}
              />
              <title>{ent}</title>
              <text
                x={lx}
                y={ly}
                fontSize="6.5"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight={isSel ? 800 : 600}
                fill={isSel ? "#FFFFFF" : color}
                textAnchor={lx > 0.5 ? "start" : lx < -0.5 ? "end" : "middle"}
                dominantBaseline="middle"
                style={{ pointerEvents: "none" }}
              >
                {short}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
