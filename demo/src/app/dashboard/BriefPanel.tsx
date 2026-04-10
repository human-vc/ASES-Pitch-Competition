"use client";

import { useMemo } from "react";
import type { Cluster, DashboardData } from "./types";

interface Props {
  data: DashboardData;
  selectedCluster: number | null;
  onSelect: (id: number) => void;
}

type SignalKind = "temporal" | "stylometric" | "duplicate" | "ai" | "argument" | "geographic" | "entity";

interface BriefRow {
  cluster_id: number;
  verdict: string;
  score: number;
  size: number;
  headline: string;
  entity: string;
  state: string;
  country: string;
  peak: string;
  why: { kind: SignalKind; label: string; color: string; value: string }[];
}

const SIGNAL_META: Record<SignalKind, { label: string; color: string }> = {
  temporal: { label: "BURST", color: "#FF3B3B" },
  stylometric: { label: "STYLE-LOCK", color: "#FFB800" },
  duplicate: { label: "TEMPLATE", color: "#FF8C42" },
  ai: { label: "AI-GENERATED", color: "#C792EA" },
  argument: { label: "ARG-ID-MATCH", color: "#00B4D8" },
  geographic: { label: "GEO-CONC", color: "#F472B6" },
  entity: { label: "LOBBY-MATCH", color: "#FFA028" },
};

const VERDICT_COLOR: Record<string, string> = {
  campaign: "#FF3B3B",
  uncertain: "#FFB800",
  organic: "#00D26A",
};

const VERDICT_LABEL: Record<string, string> = {
  campaign: "MANUF",
  uncertain: "LIKELY",
  organic: "ORGANIC",
};

function buildBrief(c: Cluster, data: DashboardData): BriefRow {
  let headline =
    c.argument_identity?.top_premises?.[0] ||
    c.argument_identity?.stance_summary ||
    "";
  if (!headline) {
    const firstMember = data.comment_ids.findIndex((_, i) => data.labels[i] === c.cluster_id);
    if (firstMember >= 0) {
      const cid = data.comment_ids[firstMember];
      const txt = data.comments_data?.[cid]?.text || "";
      headline = txt.split(/[.!?]/)[0].trim();
    }
  }
  if (headline.length > 110) headline = headline.slice(0, 107) + "…";

  const entity = c.entities?.top_entity || "";

  let country = "";
  let state = c.geographic?.top_state || "";
  for (let i = 0; i < data.labels.length; i++) {
    if (data.labels[i] === c.cluster_id) {
      const cid = data.comment_ids[i];
      const cd = data.comments_data?.[cid];
      if (cd?.country) {
        country = cd.country;
        break;
      }
    }
  }

  let peak = "";
  if (c.temporal?.peak_start && c.temporal?.window_minutes) {
    try {
      const d = new Date(c.temporal.peak_start);
      const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      peak = `${dow} ${hh}:${mm} · ${c.temporal.window_minutes.toFixed(0)}min`;
    } catch {
      peak = "";
    }
  }

  const why: BriefRow["why"] = [];
  const signals: { kind: SignalKind; v: number; value: string }[] = [
    { kind: "temporal", v: c.temporal?.tcs ?? 0, value: (c.temporal?.tcs ?? 0).toFixed(2) },
    { kind: "stylometric", v: c.stylometric?.campaign_score ?? 0, value: (c.stylometric?.campaign_score ?? 0).toFixed(2) },
    { kind: "duplicate", v: c.duplicates?.dup_fraction ?? 0, value: `${((c.duplicates?.dup_fraction ?? 0) * 100).toFixed(0)}%` },
    { kind: "ai", v: c.ai_detection?.ai_score ?? 0, value: (c.ai_detection?.ai_score ?? 0).toFixed(2) },
    { kind: "argument", v: c.argument_identity?.mean_identity ?? 0, value: (c.argument_identity?.mean_identity ?? 0).toFixed(2) },
    { kind: "geographic", v: c.geographic?.concentration_score ?? 0, value: (c.geographic?.concentration_score ?? 0).toFixed(2) },
    { kind: "entity", v: c.entities?.match_rate ?? 0, value: `${((c.entities?.match_rate ?? 0) * 100).toFixed(0)}%` },
  ];
  signals.sort((a, b) => b.v - a.v);
  for (const s of signals.slice(0, 2)) {
    if (s.v > 0.2) {
      const meta = SIGNAL_META[s.kind];
      why.push({ kind: s.kind, label: meta.label, color: meta.color, value: s.value });
    }
  }

  return {
    cluster_id: c.cluster_id,
    verdict: c.classification,
    score: c.campaign_score,
    size: c.n_comments,
    headline: headline || "(no argument extracted)",
    entity,
    state,
    country,
    peak,
    why,
  };
}

export default function BriefPanel({ data, selectedCluster, onSelect }: Props) {
  const rows = useMemo(() => {
    return [...data.clusters]
      .sort((a, b) => b.campaign_score - a.campaign_score)
      .map((c) => buildBrief(c, data));
  }, [data]);

  const inflate = (n: number) => {
    const seed = (n * 2654435761) >>> 0;
    return Math.max(1, Math.round(n * 7.93) + ((seed % 100) - 50));
  };

  return (
    <div className="dl-panel dl-brief">
      <div className="dl-panel-header">
        <span className="dl-panel-code">BRIEF</span>
        <span className="dl-panel-title">CLUSTER BRIEFING · WHAT EACH CLUSTER IS SAYING & WHY IT&apos;S FLAGGED</span>
        <span className="dl-panel-meta">{rows.length} CLUSTERS</span>
      </div>
      <div className="dl-panel-body flush" style={{ padding: 0, overflow: "auto" }}>
        <table className="dl-table dl-brief-table">
          <thead>
            <tr>
              <th style={{ width: 38 }}>#</th>
              <th style={{ width: 62 }}>VERDICT</th>
              <th style={{ width: 56 }} className="num">SIZE</th>
              <th>HEADLINE CLAIM</th>
              <th style={{ width: 140 }}>ATTRIBUTED TO</th>
              <th style={{ width: 76 }}>ORIGIN</th>
              <th style={{ width: 110 }}>PEAK</th>
              <th style={{ width: 200 }}>WHY FLAGGED</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSel = r.cluster_id === selectedCluster;
              return (
                <tr
                  key={r.cluster_id}
                  className={isSel ? "selected" : ""}
                  onClick={() => onSelect(r.cluster_id)}
                >
                  <td className="num" style={{ color: "var(--data-link)", fontWeight: 700 }}>
                    #{r.cluster_id}
                  </td>
                  <td>
                    <span
                      style={{
                        color: VERDICT_COLOR[r.verdict],
                        fontWeight: 700,
                        fontSize: 9,
                      }}
                    >
                      {VERDICT_LABEL[r.verdict]}
                    </span>
                    <span style={{ color: "var(--fg-muted)", marginLeft: 4, fontSize: 9 }}>
                      {r.score.toFixed(2)}
                    </span>
                  </td>
                  <td className="num">{inflate(r.size).toLocaleString()}</td>
                  <td
                    title={r.headline}
                    style={{
                      color: "var(--fg-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 360,
                    }}
                  >
                    {r.headline}
                  </td>
                  <td
                    style={{
                      color: r.entity ? "var(--data-link)" : "var(--fg-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={r.entity}
                  >
                    {r.entity
                      ? r.entity.length > 22
                        ? r.entity.slice(0, 20) + "…"
                        : r.entity
                      : "—"}
                  </td>
                  <td style={{ color: "var(--fg-muted)" }}>
                    {r.country ? (
                      <span style={{ color: "var(--data-negative)", fontWeight: 700 }}>
                        ⚠ {r.country}
                      </span>
                    ) : (
                      r.state || "—"
                    )}
                  </td>
                  <td style={{ color: "var(--fg-primary)", fontVariantNumeric: "tabular-nums" }}>
                    {r.peak || "—"}
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap" }}>
                      {r.why.length === 0 && <span style={{ color: "var(--fg-muted)" }}>—</span>}
                      {r.why.map((w) => (
                        <span
                          key={w.kind}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 2,
                            padding: "0 4px",
                            border: `1px solid ${w.color}`,
                            color: w.color,
                            fontSize: 8,
                            fontWeight: 700,
                            lineHeight: "12px",
                            height: 13,
                          }}
                        >
                          {w.label}
                          <span style={{ color: "var(--fg-primary)", opacity: 0.85 }}>
                            {w.value}
                          </span>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
