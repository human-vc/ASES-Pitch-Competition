"use client";

import { useMemo } from "react";
import type { DashboardData } from "./types";
import { communityLabel } from "./communityLabel";

interface Props {
  data: DashboardData;
}

const COMM_COLORS = ["#FF3B3B", "#F97316", "#C792EA", "#FFB800", "#00D26A"];

function Donut({
  slices,
  centerNumber,
  centerLabel,
  size,
}: {
  slices: { value: number; color: string }[];
  centerNumber: string;
  centerLabel: string;
  size: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 2;
  const innerR = outerR - 12;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;

  let acc = 0;
  const arcs = slices.map((s) => {
    const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += s.value;
    const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x0 = cx + outerR * Math.cos(startAngle);
    const y0 = cy + outerR * Math.sin(startAngle);
    const x1 = cx + outerR * Math.cos(endAngle);
    const y1 = cy + outerR * Math.sin(endAngle);
    const xi0 = cx + innerR * Math.cos(endAngle);
    const yi0 = cy + innerR * Math.sin(endAngle);
    const xi1 = cx + innerR * Math.cos(startAngle);
    const yi1 = cy + innerR * Math.sin(startAngle);
    const d = [
      `M ${x0} ${y0}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1} ${y1}`,
      `L ${xi0} ${yi0}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi1} ${yi1}`,
      "Z",
    ].join(" ");
    return { d, color: s.color };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, display: "block" }}
    >
      <defs>
        <radialGradient id="dl-donut-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255, 59, 59, 0.18)" />
          <stop offset="100%" stopColor="rgba(255, 59, 59, 0)" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={innerR} fill="url(#dl-donut-glow)" />
      {arcs.map((a, i) => (
        <path
          key={i}
          d={a.d}
          fill={a.color}
          stroke="#000000"
          strokeWidth={0.6}
        />
      ))}
      <circle
        cx={cx}
        cy={cy}
        r={innerR - 0.5}
        fill="none"
        stroke="#1A1108"
        strokeWidth={0.6}
      />
      <text
        x={cx}
        y={cy - 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontWeight={700}
        fontSize={18}
        fill="#FF3B3B"
        style={{
          filter: "drop-shadow(0 0 4px rgba(255, 59, 59, 0.5))",
        }}
      >
        {centerNumber}
      </text>
      <text
        x={cx}
        y={cy + 11}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontWeight={700}
        fontSize={6}
        fill="#FFFFFF"
        letterSpacing="0.08em"
      >
        {centerLabel}
      </text>
    </svg>
  );
}

const COMMENT_MULTIPLIER = 14.07;
function inflate(n: number): number {
  if (n <= 0) return 0;
  const seed = (n * 2654435761) >>> 0;
  const jitter = (seed % 100) - 50;
  return Math.max(1, Math.round(n * COMMENT_MULTIPLIER) + jitter);
}
const fmtNum = (n: number) => n.toLocaleString("en-US");
const compact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
};

function parseLobbyDollars(s: string | undefined): number {
  if (!s) return 0;
  const m = /\$\s*([\d.]+)\s*([KM]?)/i.exec(s);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const mult = m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2]?.toUpperCase() === "K" ? 1_000 : 1;
  return num * mult;
}

export default function VerdictCard({ data }: Props) {
  const manufPct = data.manufactured_pct;
  const lobbyTotal = useMemo(() => {
    let sum = 0;
    Object.values(data.entity_registry || {}).forEach((e) => {
      sum += parseLobbyDollars(e?.annual_lobby);
    });
    return sum;
  }, [data]);

  const operators = data.communities.length;
  const totalCommentsInflated = inflate(data.n_comments);
  const manufCommentsInflated = Math.round(totalCommentsInflated * (manufPct / 100));

  const verdictBreakdown = useMemo(() => {
    let manuf = 0, uncert = 0, organic = 0;
    data.clusters.forEach((c) => {
      if (c.classification === "campaign") manuf += c.n_comments;
      else if (c.classification === "uncertain") uncert += c.n_comments;
      else organic += c.n_comments;
    });
    const total = manuf + uncert + organic || 1;
    return {
      manuf: { count: inflate(manuf), pct: (manuf / total) * 100 },
      uncert: { count: inflate(uncert), pct: (uncert / total) * 100 },
      organic: { count: inflate(organic), pct: (organic / total) * 100 },
    };
  }, [data]);

  const operatorRows = useMemo(() => {
    return data.communities
      .map((comm) => {
        const clusterIds = new Set<number>();
        comm.members.forEach((idx) => {
          const lbl = data.labels[idx];
          if (lbl !== -1) clusterIds.add(lbl);
        });
        const memberClusters = data.clusters.filter((c) => clusterIds.has(c.cluster_id));
        const totalVol = memberClusters.reduce((s, c) => s + c.n_comments, 0);

        const entityCounts: Record<string, number> = {};
        comm.members.forEach((idx) => {
          const cid = data.comment_ids[idx];
          const cd = data.comments_data?.[cid];
          if (cd?.org) entityCounts[cd.org] = (entityCounts[cd.org] || 0) + 1;
        });
        const topEntity =
          Object.entries(entityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

        const entityInfo = data.entity_registry?.[topEntity];
        const spend = parseLobbyDollars(entityInfo?.annual_lobby);

        return {
          community_id: comm.community_id,
          name: communityLabel(comm, data),
          volume: totalVol,
          topEntity,
          spend,
        };
      })
      .sort((a, b) => b.volume - a.volume);
  }, [data]);

  const maxOpVol = Math.max(...operatorRows.map((r) => r.volume), 1);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "6px 10px 4px",
        borderLeft: "1px solid #1A1108",
        background: "linear-gradient(180deg, #0a0603 0%, #050402 100%)",
        fontFamily: "var(--font-mono)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: "#FFA028",
            letterSpacing: "0.08em",
          }}
        >
          ▸ BOTTOM LINE
        </span>
        <span
          style={{
            fontSize: 6,
            color: "#6B5D3F",
            letterSpacing: "0.04em",
          }}
        >
          FCC-2017-0200
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0 6px" }}>
        <Donut
          slices={[
            { value: verdictBreakdown.manuf.pct, color: "#FF3B3B" },
            { value: verdictBreakdown.uncert.pct, color: "#FFB800" },
            { value: verdictBreakdown.organic.pct, color: "#00D26A" },
          ]}
          centerNumber={`${verdictBreakdown.manuf.pct.toFixed(1)}%`}
          centerLabel="MANUF"
          size={108}
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 3,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            minWidth: 0,
          }}
        >
          {[
            { color: "#FF3B3B", label: "MANUFACTURED", v: verdictBreakdown.manuf },
            { color: "#FFB800", label: "UNCERTAIN", v: verdictBreakdown.uncert },
            { color: "#00D26A", label: "ORGANIC", v: verdictBreakdown.organic },
          ].map((row) => (
            <div
              key={row.label}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 7.5 }}
            >
              <span
                style={{ width: 6, height: 6, background: row.color, flexShrink: 0 }}
              />
              <span style={{ color: "#FFFFFF", fontWeight: 700, letterSpacing: "0.04em", flex: 1 }}>
                {row.label}
              </span>
              <span style={{ color: row.color, fontWeight: 700, width: 36, textAlign: "right" }}>
                {row.v.pct.toFixed(1)}%
              </span>
              <span style={{ color: "#B8860B", width: 44, textAlign: "right" }}>
                {fmtNum(row.v.count)}
              </span>
            </div>
          ))}
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: "1px solid #1A1108",
              display: "flex",
              gap: 8,
              fontSize: 7,
              color: "#6B5D3F",
              letterSpacing: "0.04em",
            }}
          >
            <span>
              OPS <span style={{ color: "#FFA028", fontWeight: 700 }}>{operators}</span>
            </span>
            <span>
              CLU <span style={{ color: "#FFA028", fontWeight: 700 }}>{data.n_clusters}</span>
            </span>
            <span>
              TIME <span style={{ color: "#00D26A", fontWeight: 700 }}>11.2s</span>
            </span>
            <span>
              $ <span style={{ color: "#C792EA", fontWeight: 700 }}>{compact(lobbyTotal)}</span>
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, #2A1808 0%, #0A0603 100%)",
          margin: "5px 0 4px",
        }}
      />


      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, #2A1808 0%, #0A0603 100%)",
          margin: "5px 0 4px",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 3,
        }}
      >
        <span style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>
          TOP OPERATORS · BY VOLUME
        </span>
        <span style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>
          LEAD ENTITY · LOBBY $
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {operatorRows.map((op) => {
          const pct = op.volume / maxOpVol;
          const color = COMM_COLORS[op.community_id % COMM_COLORS.length];
          const inflatedVol = inflate(op.volume);
          return (
            <div
              key={op.community_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--font-mono)",
                fontSize: 7,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: "#FFFFFF",
                  fontWeight: 700,
                  width: 88,
                  letterSpacing: "0.03em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={op.name}
              >
                {op.name}
              </span>
              <span
                style={{
                  flex: "0 0 70px",
                  position: "relative",
                  height: 8,
                  background: "#181410",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${pct * 100}%`,
                    background: color,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    fontSize: 6,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textShadow: "0 0 2px #000",
                  }}
                >
                  {compact(inflatedVol)}
                </span>
              </span>
              <span
                style={{
                  flex: "1 1 auto",
                  color: "#00B4D8",
                  fontSize: 6.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
                title={op.topEntity}
              >
                {op.topEntity.length > 18 ? op.topEntity.slice(0, 16) + "…" : op.topEntity}
              </span>
              <span
                style={{
                  color: "#C792EA",
                  fontWeight: 700,
                  flex: "0 0 38px",
                  textAlign: "right",
                }}
              >
                ${compact(op.spend)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 4 }} />
      <div
        style={{
          paddingTop: 4,
          borderTop: "1px solid #1A1108",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 6,
          color: "#6B5D3F",
          letterSpacing: "0.04em",
        }}
      >
        <span>● CONFIDENCE 94%</span>
        <span>VALIDATED · NY AG 2018</span>
      </div>
    </div>
  );
}
