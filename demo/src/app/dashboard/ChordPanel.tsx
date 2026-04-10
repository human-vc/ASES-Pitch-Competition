"use client";

import { useMemo, useState } from "react";
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

const ENTITY_SHORT: Record<string, string> = {
  "Internet & Television Association": "NCTA",
  "American Bankers Association": "ABA",
  "American Petroleum Institute": "API",
  "Heritage Foundation": "HERITAGE",
  "Americans for Tax Reform": "ATR",
  "Free State Foundation": "FSF",
  "TechFreedom": "TECHFREE",
  "American Coalition for Clean Coal Electricity": "ACCCE",
  "Edison Electric Institute": "EEI",
  "USTelecom Association": "USTELECOM",
  "CTIA - The Wireless Association": "CTIA",
  "Phoenix Center": "PHOENIX",
  "Securities Industry and Financial Markets Association": "SIFMA",
  "FreedomWorks": "FREEDOMWKS",
  "CQ Roll Call (lead-gen)": "CQ ROLL",
  "Voter Voice (Capitol Advantage)": "VOTERVOICE",
  "Opt-Intelligence": "OPT-INTEL",
  "Fluent Inc": "FLUENT",
};
function shortName(ent: string): string {
  if (ENTITY_SHORT[ent]) return ENTITY_SHORT[ent];
  const words = ent.split(/\s+/).filter((w) => w.length >= 3 && !/^(of|the|and|for)$/i.test(w));
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 6);
  return ent.toUpperCase().slice(0, 8);
}

export default function ChordPanel({
  data,
  width,
  height,
  selectedEntity,
  onSelectEntity,
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { matrix, entities, totalsByEntity } = useMemo(() => {
    const entCounts: Record<string, number> = {};
    Object.values(data.comments_data || {}).forEach((c) => {
      if (c?.org) entCounts[c.org] = (entCounts[c.org] || 0) + 1;
    });
    const topEnts = Object.entries(entCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map((e) => e[0]);

    if (topEnts.length < 2) {
      return { matrix: [], entities: [], totalsByEntity: {} };
    }

    const m = topEnts.map(() => topEnts.map(() => 0));
    const idxMap = Object.fromEntries(topEnts.map((e, i) => [e, i]));

    data.clusters.forEach((cluster) => {
      const cid = cluster.cluster_id;
      const memberIds = data.comment_ids.filter((_, i) => data.labels[i] === cid);
      const orgsInCluster = new Set<string>();
      memberIds.forEach((id) => {
        const c = data.comments_data?.[id];
        if (c?.org && c.org in idxMap) orgsInCluster.add(c.org);
      });
      const orgList = Array.from(orgsInCluster);
      orgList.forEach((a) => {
        const ai = idxMap[a];
        orgList.forEach((b) => {
          if (a === b) return;
          const bi = idxMap[b];
          m[ai][bi] += 1;
        });
      });
    });

    // Each entity row needs SOME mass for d3-chord to give it an arc; if a row sums
    // to zero (entity exists but never co-occurs) bias the diagonal slightly so it
    // still appears on the ring with a thin slice.
    for (let i = 0; i < m.length; i++) {
      const rowSum = m[i].reduce((s, x) => s + x, 0);
      if (rowSum === 0) m[i][i] = 1;
    }

    return { matrix: m, entities: topEnts, totalsByEntity: entCounts };
  }, [data]);

  const totalConnections = useMemo(() => {
    let s = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix.length; j++) s += matrix[i][j];
    }
    return s;
  }, [matrix]);

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

  const padTop = 6;
  const padBottom = 14;
  const cy = (height - padTop - padBottom) / 2 + padTop;
  const cx = width / 2;
  const outerRadius = Math.min(width, height) / 2 - 32;
  const innerRadius = outerRadius - 7;

  const chordGen = chord().padAngle(0.05).sortSubgroups((a, b) => b - a);
  const chords = chordGen(matrix);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arcGen = d3Arc<any>().innerRadius(innerRadius).outerRadius(outerRadius);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ribbonGen: any = ribbon().radius(innerRadius - 0.5);

  const activeIdx =
    hoverIdx != null
      ? hoverIdx
      : selectedEntity != null
      ? entities.indexOf(selectedEntity)
      : -1;
  const activeEntity = activeIdx >= 0 ? entities[activeIdx] : null;

  const activeStats = useMemo(() => {
    if (activeIdx < 0) return null;
    let partners = 0;
    let coClusters = 0;
    matrix[activeIdx]?.forEach((v, j) => {
      if (j === activeIdx) return;
      if (v > 0) {
        partners++;
        coClusters += v;
      }
    });
    return { partners, coClusters };
  }, [activeIdx, matrix]);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="dl-svg"
      style={{ display: "block" }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <g transform={`translate(${cx},${cy})`}>
        {chords.map((c, i) => {
          const color = ENTITY_COLORS[c.source.index % ENTITY_COLORS.length];
          const d = ribbonGen(c);
          if (c.source.index === c.target.index) return null;
          const touchesActive =
            activeIdx < 0 ||
            c.source.index === activeIdx ||
            c.target.index === activeIdx;
          return (
            <path
              key={i}
              d={typeof d === "string" ? d : ""}
              fill={color}
              fillOpacity={
                activeIdx < 0 ? 0.32 : touchesActive ? 0.6 : 0.04
              }
              stroke={color}
              strokeOpacity={
                activeIdx < 0 ? 0.45 : touchesActive ? 0.8 : 0.06
              }
              strokeWidth={touchesActive ? 0.5 : 0.3}
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {chords.groups.map((g, i) => {
          const color = ENTITY_COLORS[i % ENTITY_COLORS.length];
          const midAngle = (g.startAngle + g.endAngle) / 2 - Math.PI / 2;
          const labelR = outerRadius + 4;
          const lx = Math.cos(midAngle) * labelR;
          const ly = Math.sin(midAngle) * labelR;
          const ent = entities[i] || "";
          const isSel = selectedEntity === ent;
          const isHov = hoverIdx === i;
          const isActive = isSel || isHov;
          const dim = activeIdx >= 0 && !isActive;
          const short = shortName(ent);
          return (
            <g
              key={i}
              onClick={() => {
                if (onSelectEntity) onSelectEntity(isSel ? null : ent);
              }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: onSelectEntity ? "pointer" : "default" }}
            >
              <path
                d={arcGen(g) || ""}
                fill={color}
                opacity={dim ? 0.25 : 1}
                stroke={isSel ? "#FFFFFF" : "transparent"}
                strokeWidth={isSel ? 1.2 : 0}
              />
              <title>
                {ent} ({totalsByEntity[ent] || 0} comments)
              </title>
              <text
                x={lx}
                y={ly}
                fontSize={isActive ? 7 : 6.5}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight={isActive ? 800 : 700}
                fill={isActive ? "#FFFFFF" : dim ? "#6B5D3F" : color}
                textAnchor={lx > 1 ? "start" : lx < -1 ? "end" : "middle"}
                dominantBaseline="middle"
                style={{ pointerEvents: "none" }}
              >
                {short}
              </text>
            </g>
          );
        })}

        {activeEntity && activeStats ? (
          <g style={{ pointerEvents: "none" }}>
            <text
              x={0}
              y={-6}
              textAnchor="middle"
              fontSize="7"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={800}
              fill="#FFFFFF"
            >
              {shortName(activeEntity)}
            </text>
            <text
              x={0}
              y={3}
              textAnchor="middle"
              fontSize="5.5"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
              fill="#FFA028"
            >
              {activeStats.partners} PARTNERS
            </text>
            <text
              x={0}
              y={11}
              textAnchor="middle"
              fontSize="5.5"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
              fill="#B8860B"
            >
              {activeStats.coClusters} SHARED
            </text>
          </g>
        ) : (
          <g style={{ pointerEvents: "none" }}>
            <text
              x={0}
              y={-3}
              textAnchor="middle"
              fontSize="6"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={700}
              fill="#6B5D3F"
              letterSpacing="0.05em"
            >
              {entities.length} ENTITIES
            </text>
            <text
              x={0}
              y={6}
              textAnchor="middle"
              fontSize="5.5"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
              fill="#6B5D3F"
              letterSpacing="0.04em"
            >
              {totalConnections} LINKS
            </text>
          </g>
        )}
      </g>

      <text
        x={cx}
        y={height - 3}
        textAnchor="middle"
        fontSize="6"
        fontFamily="IBM Plex Mono, monospace"
        fill="#6B5D3F"
        letterSpacing="0.05em"
      >
        ENTITIES SHARING CLUSTERS · CLICK TO FILTER
      </text>
    </svg>
  );
}
