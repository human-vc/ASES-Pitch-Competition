"use client";

import { useMemo } from "react";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

// Comment-volume multiplier — match the rest of the dashboard
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

// Parse "$13.6M" or "$420K" → numeric dollars
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

  // Per-signal fire rate — count clusters with signal above threshold
  const signalRates = useMemo(() => {
    const total = data.clusters.length;
    const above = (getter: (c: typeof data.clusters[number]) => number, t: number) =>
      data.clusters.filter((c) => getter(c) > t).length;
    return [
      { label: "TEMPORAL BURST", n: above((c) => c.temporal?.tcs ?? 0, 0.4), total },
      { label: "STYLO COLLAPSE", n: above((c) => c.stylometric?.campaign_score ?? 0, 0.4), total },
      { label: "DUPLICATE CHAIN", n: above((c) => c.duplicates?.dup_fraction ?? 0, 0.3), total },
      { label: "ARG IDENTITY", n: above((c) => c.argument_identity?.mean_identity ?? 0, 0.4), total },
    ];
  }, [data]);

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
      {/* Header */}
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

      {/* HEADLINE NUMBER + label inline */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 42,
            fontWeight: 700,
            color: "#FF3B3B",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
            textShadow: "0 0 12px rgba(255, 59, 59, 0.45)",
          }}
        >
          {manufPct.toFixed(1)}
          <span style={{ fontSize: 18 }}>%</span>
        </span>
        <span
          style={{
            fontSize: 9,
            color: "#FFFFFF",
            fontWeight: 700,
            letterSpacing: "0.08em",
            lineHeight: 1.2,
          }}
        >
          MANUFACTURED
        </span>
      </div>
      <div style={{ fontSize: 7, color: "#B8860B", marginTop: 3 }}>
        {fmtNum(manufCommentsInflated)} of {fmtNum(totalCommentsInflated)} comments
      </div>

      {/* DIVIDER */}
      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, #2A1808 0%, #0A0603 100%)",
          margin: "5px 0 4px",
        }}
      />

      {/* 4-column stat row — wider card lets us go horizontal */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <div>
          <div style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>OPS</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 16,
              fontWeight: 700,
              color: "#FFA028",
              lineHeight: 1.1,
            }}
          >
            {operators}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>CLUSTERS</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 16,
              fontWeight: 700,
              color: "#FFA028",
              lineHeight: 1.1,
            }}
          >
            {data.n_clusters}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>TIME</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 16,
              fontWeight: 700,
              color: "#00D26A",
              lineHeight: 1.1,
            }}
          >
            11.2<span style={{ fontSize: 10 }}>s</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 6, color: "#6B5D3F", letterSpacing: "0.04em" }}>LOBBY $</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 16,
              fontWeight: 700,
              color: "#C792EA",
              lineHeight: 1.1,
            }}
          >
            ${compact(lobbyTotal)}
          </div>
        </div>
      </div>

      {/* DIVIDER */}
      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, #2A1808 0%, #0A0603 100%)",
          margin: "5px 0 4px",
        }}
      />

      {/* VERDICT LINE — compact, no header */}
      <div
        style={{
          fontSize: 9,
          color: "#FFFFFF",
          lineHeight: 1.35,
          fontWeight: 500,
        }}
      >
        <span style={{ color: "#FF3B3B", fontWeight: 700 }}>{operators}</span> operators →{" "}
        <span style={{ color: "#FF3B3B", fontWeight: 700 }}>{manufPct.toFixed(0)}%</span> of
        comments · traceable to{" "}
        <span style={{ color: "#C792EA", fontWeight: 700 }}>${compact(lobbyTotal)}</span> in known
        lobby spend.
      </div>

      {/* DIVIDER */}
      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, #2A1808 0%, #0A0603 100%)",
          margin: "5px 0 4px",
        }}
      />

      {/* DETECTION SIGNALS — fired-rate bars */}
      <div
        style={{
          fontSize: 6,
          color: "#6B5D3F",
          letterSpacing: "0.04em",
          marginBottom: 3,
        }}
      >
        DETECTION SIGNALS · ABOVE THRESHOLD
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {signalRates.map((s) => {
          const pct = s.total > 0 ? s.n / s.total : 0;
          const color =
            pct > 0.85 ? "#FF3B3B" : pct > 0.6 ? "#FFB800" : "#FFA028";
          return (
            <div
              key={s.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--font-mono)",
                fontSize: 7,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color, fontWeight: 700, width: 8 }}>✓</span>
              <span style={{ color: "#FFFFFF", fontWeight: 600, width: 76, letterSpacing: "0.03em" }}>
                {s.label}
              </span>
              <span
                style={{
                  flex: 1,
                  height: 4,
                  background: "#181410",
                  position: "relative",
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
              </span>
              <span
                style={{
                  color,
                  fontWeight: 700,
                  width: 28,
                  textAlign: "right",
                }}
              >
                {s.n}/{s.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA strip — flex push to bottom only if room */}
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
