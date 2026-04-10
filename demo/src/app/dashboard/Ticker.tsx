"use client";

import { useMemo } from "react";
import type { DashboardData } from "./types";

interface Props {
  data: DashboardData;
}

const ENTITIES = [
  "Internet & Television Association",
  "American Bankers Association",
  "Auto Insurance Coalition",
  "Free State Foundation",
  "Phoenix Center for Advanced Legal Studies",
  "TechFreedom",
  "Americans for Tax Reform",
];

const EVENT_TYPES = [
  "FLAGGED",
  "BURST DETECTED",
  "ENTITY MATCH",
  "ARG IDENTITY MATCH",
  "PARAPHRASE PROBE",
  "STYLOMETRIC ANOMALY",
  "GEO CONCENTRATION",
];

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function tsString(offsetSec: number) {
  const d = new Date(Date.now() - offsetSec * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export default function Ticker({ data }: Props) {
  const events = useMemo(() => {
    const evs: { ts: string; type: string; cluster: number; score: number; alert?: boolean; msg: string }[] = [];
    // Build ~40 events from the cluster data
    const sorted = [...data.clusters]
      .filter((c) => c.classification === "campaign")
      .sort((a, b) => b.campaign_score - a.campaign_score)
      .slice(0, 30);
    sorted.forEach((c, i) => {
      const offset = i * 47 + Math.floor(Math.random() * 30);
      const tcs = c.temporal?.tcs ?? 0;
      const dup = c.duplicates?.dup_fraction ?? 0;
      const arg = c.argument_identity?.mean_identity ?? 0;
      const ai = c.ai_detection?.ai_score ?? 0;
      const peak = c.temporal?.peak_count ?? 0;
      const win = c.temporal?.window_minutes ?? 0;
      const top_state = c.geographic?.top_state;
      const top_pct = c.geographic?.top_state_pct ?? 0;
      const top_entity = c.entities?.top_entity;

      // Burst detection
      if (tcs > 0.5 && win > 0) {
        evs.push({
          ts: tsString(offset),
          type: "BURST DETECTED",
          cluster: c.cluster_id,
          score: tcs,
          alert: true,
          msg: `${(peak * 8).toLocaleString()} comments in ${win.toFixed(0)}min · Λ*${c.temporal?.lambda_star?.toFixed(0)}`,
        });
      }
      // High score flag
      if (c.campaign_score > 0.7) {
        evs.push({
          ts: tsString(offset + 5),
          type: "FLAGGED",
          cluster: c.cluster_id,
          score: c.campaign_score,
          alert: true,
          msg: `score ${c.campaign_score.toFixed(2)} · MANUFACTURED`,
        });
      }
      // Argument identity
      if (arg > 0.4) {
        evs.push({
          ts: tsString(offset + 10),
          type: "ARG IDENTITY MATCH",
          cluster: c.cluster_id,
          score: arg,
          msg: `${c.argument_identity?.top_premises?.[0]?.slice(0, 60) || "shared premise detected"}`,
        });
      }
      // Geographic
      if (top_state && top_pct > 0.5) {
        evs.push({
          ts: tsString(offset + 15),
          type: "GEO CONCENTRATION",
          cluster: c.cluster_id,
          score: top_pct,
          msg: `${top_state} ${(top_pct * 100).toFixed(0)}% · KL ${c.geographic?.kl_divergence?.toFixed(2)}`,
        });
      }
      // Entity match
      if (top_entity) {
        evs.push({
          ts: tsString(offset + 20),
          type: "ENTITY MATCH",
          cluster: c.cluster_id,
          score: c.entities?.match_rate ?? 0,
          msg: `${top_entity}`,
        });
      }
      // AI detection
      if (ai > 0.6) {
        evs.push({
          ts: tsString(offset + 25),
          type: "AI ANOMALY",
          cluster: c.cluster_id,
          score: ai,
          msg: `surprisal var ratio ${c.ai_detection?.median_std_ratio?.toFixed(2)}`,
        });
      }
    });
    return evs.sort((a, b) => a.ts.localeCompare(b.ts));
  }, [data]);

  // Repeat the events twice for seamless scroll
  const looped = [...events, ...events];

  return (
    <div className="dl-ticker">
      <div className="dl-ticker-label">▶ FEED</div>
      <div className="dl-ticker-track">
        {looped.map((ev, i) => (
          <span key={i} className="dl-ticker-item">
            <span className="ts">[{ev.ts}]</span>
            <span className={ev.alert ? "alert" : "ev"}>{ev.type}</span>
            <span style={{ color: "var(--fg-muted)", margin: "0 4px" }}>·</span>
            <span style={{ color: "var(--fg-primary)" }}>CLUS {ev.cluster}</span>
            <span style={{ color: "var(--fg-muted)", margin: "0 4px" }}>·</span>
            <span style={{ color: "var(--fg-secondary)" }}>{ev.msg}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
