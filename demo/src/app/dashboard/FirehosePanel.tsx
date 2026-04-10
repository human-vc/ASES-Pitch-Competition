"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, DashboardData } from "./types";

interface Props {
  data: DashboardData;
  selectedCluster: number | null;
  onSelect: (id: number) => void;
  selectedCountry?: string | null;
  ingesting?: boolean;
  onIngestComment?: (clusterId: number) => void;
}

interface FirehoseEntry {
  id: string;
  text: string;
  cluster_id: number;
  classification: string;
  campaign_score: number;
  org: string;
  state: string;
  country: string;
  reason: string;
  reasonColor: string;
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function tsString(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const REASONS = [
  { key: "burst", color: "#FF3B3B", label: "BURST WINDOW" },
  { key: "stylo", color: "#FFB800", label: "LOW STYLE VAR" },
  { key: "ai", color: "#C792EA", label: "AI SIGNATURE" },
  { key: "arg", color: "#00B4D8", label: "ARG ID MATCH" },
  { key: "geo", color: "#F472B6", label: "GEO ANOMALY" },
  { key: "ent", color: "#FFA028", label: "ENTITY MATCH" },
  { key: "dup", color: "#FF8C42", label: "TEMPLATE MATCH" },
  { key: "foreign", color: "#FF1A1A", label: "FOREIGN ORIGIN" },
];

export default function FirehosePanel({ data, selectedCluster, onSelect, selectedCountry, ingesting, onIngestComment }: Props) {
  const [now, setNow] = useState<Date>(new Date());
  const [paused, setPaused] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);

  const pool = useMemo(() => {
    const entries: FirehoseEntry[] = [];
    const clusterMap = new Map(data.clusters.map((c) => [c.cluster_id, c]));

    data.comment_ids.forEach((cid, i) => {
      const lbl = data.labels[i];
      if (lbl === -1) return;
      const cluster = clusterMap.get(lbl) as Cluster | undefined;
      if (!cluster) return;
      const cd = data.comments_data?.[cid];
      if (!cd?.text || cd.text.length < 20) return;
      if (selectedCountry && cd.country !== selectedCountry) return;
      if (cluster.classification === "campaign" || (cluster.classification === "organic" && Math.random() < 0.05) || selectedCountry) {

        let reason = REASONS[0];
        if (cd.country) reason = REASONS.find((r) => r.key === "foreign")!;
        else if ((cluster.temporal?.tcs ?? 0) > 0.7) reason = REASONS.find((r) => r.key === "burst")!;
        else if ((cluster.argument_identity?.mean_identity ?? 0) > 0.4) reason = REASONS.find((r) => r.key === "arg")!;
        else if ((cluster.ai_detection?.ai_score ?? 0) > 0.6) reason = REASONS.find((r) => r.key === "ai")!;
        else if ((cluster.duplicates?.dup_fraction ?? 0) > 0.5) reason = REASONS.find((r) => r.key === "dup")!;
        else if ((cluster.geographic?.concentration_score ?? 0) > 0.5) reason = REASONS.find((r) => r.key === "geo")!;
        else if ((cluster.entities?.match_rate ?? 0) > 0.3) reason = REASONS.find((r) => r.key === "ent")!;
        else if ((cluster.stylometric?.campaign_score ?? 0) > 0.6) reason = REASONS.find((r) => r.key === "stylo")!;

        entries.push({
          id: cid,
          text: cd.text,
          cluster_id: lbl,
          classification: cluster.classification,
          campaign_score: cluster.campaign_score,
          org: cd.org || "",
          state: cd.state || "",
          country: cd.country_name || "",
          reason: reason.label,
          reasonColor: reason.color,
        });
      }
    });

    return entries.sort(() => Math.random() - 0.5).slice(0, 200);
  }, [data, selectedCountry]);

  const ingestCallbackRef = useRef(onIngestComment);
  ingestCallbackRef.current = onIngestComment;
  const poolRef = useRef(pool);
  poolRef.current = pool;

  const scrollSpeed = ingesting ? 350 : 1100;
  const scrollOffsetRef = useRef(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const p = poolRef.current;
      const next = (scrollOffsetRef.current + 1) % Math.max(1, p.length);
      scrollOffsetRef.current = next;
      setScrollOffset(next);
      setNow(new Date());
      // Fire outside setState updater to avoid "cannot update while rendering" error
      if (ingestCallbackRef.current && p[next]) {
        ingestCallbackRef.current(p[next].cluster_id);
      }
    }, scrollSpeed);
    return () => clearInterval(id);
  }, [paused, scrollSpeed]);

  const VISIBLE = 9;
  const visibleEntries = useMemo(() => {
    const out: FirehoseEntry[] = [];
    for (let i = 0; i < VISIBLE; i++) {
      const idx = (scrollOffset + i) % Math.max(1, pool.length);
      if (pool[idx]) out.push(pool[idx]);
    }
    return out;
  }, [pool, scrollOffset]);

  return (
    <div className="dl-panel dl-heat">
      <div className="dl-panel-header">
        <span className="dl-panel-code">FEED</span>
        <span className="dl-panel-title">LIVE COMMENT FIREHOSE · FLAGGED INBOUND</span>
        <span
          className="dl-panel-meta"
          style={{ cursor: "pointer", color: paused ? "var(--data-neutral)" : "var(--data-positive)" }}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "▶ PAUSED" : "● LIVE"} · {pool.length} POOL
        </span>
      </div>
      <div className="dl-panel-body" style={{ padding: "4px 6px", overflow: "hidden" }}>
        {visibleEntries.map((e, i) => {
          const isSelected = e.cluster_id === selectedCluster;
          const ageSeconds = i * 1.1;
          const t = new Date(now.getTime() - ageSeconds * 1000);
          return (
            <div
              key={`${e.id}-${i}`}
              onClick={() => onSelect(e.cluster_id)}
              style={{
                display: "flex",
                gap: 6,
                padding: "2px 4px",
                borderBottom: "1px solid var(--border-default)",
                cursor: "pointer",
                background: isSelected ? "var(--bg-selected)" : i === 0 ? "rgba(255,160,40,0.07)" : "transparent",
                fontSize: 9,
                lineHeight: 1.35,
              }}
            >
              <span
                style={{
                  width: 4,
                  background: e.reasonColor,
                  flexShrink: 0,
                }}
              />
              <span style={{ width: 50, color: "var(--fg-muted)", flexShrink: 0 }}>
                {tsString(t)}
              </span>
              <span
                style={{
                  width: 96,
                  color: e.reasonColor,
                  fontWeight: 700,
                  flexShrink: 0,
                  fontSize: 8,
                }}
              >
                {e.reason}
              </span>
              <span style={{ width: 44, color: "var(--data-link)", flexShrink: 0, fontWeight: 600 }}>
                CLUS {e.cluster_id}
              </span>
              <span
                style={{
                  flex: 1,
                  color: "var(--fg-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={e.text}
              >
                "{e.text.slice(0, 100)}{e.text.length > 100 ? "…" : ""}"
              </span>
              <span style={{ width: 30, textAlign: "right", color: "var(--fg-muted)", flexShrink: 0, fontSize: 8 }}>
                {e.country ? e.country.slice(0, 6) : e.state}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
