"use client";

import { useMemo } from "react";
import type { DashboardData, EntityInfo } from "./types";

interface Props {
  entityName: string;
  data: DashboardData;
  onClose: () => void;
  onSelectCluster: (id: number) => void;
}

const INTENSITY_COLORS: Record<string, string> = {
  very_high: "#FF3B3B",
  high: "#FFB800",
  medium: "#FFA028",
  low: "#00D26A",
};

export default function EntityModal({ entityName, data, onClose, onSelectCluster }: Props) {
  const info: EntityInfo = data.entity_registry?.[entityName] || {
    sector: "Unknown",
    type: "Unknown",
    intensity: "medium",
    why: "Entity matched in commenter affiliations. Detailed registry information not available.",
    annual_lobby: "—",
  };

  // Find which clusters this entity dominates
  const clusterMatches = useMemo(() => {
    const map: Record<number, { count: number; total: number }> = {};
    data.labels.forEach((lbl, i) => {
      if (lbl === -1) return;
      const cid = data.comment_ids[i];
      const cd = data.comments_data?.[cid];
      if (!map[lbl]) map[lbl] = { count: 0, total: 0 };
      map[lbl].total++;
      if (cd?.org === entityName) map[lbl].count++;
    });
    return Object.entries(map)
      .filter(([, v]) => v.count > 0)
      .map(([id, v]) => ({
        cluster_id: parseInt(id),
        count: v.count,
        pct: v.count / v.total,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [entityName, data]);

  const totalComments = clusterMatches.reduce((s, c) => s + c.count, 0);

  // Sample comments mentioning this entity
  const sampleComments = useMemo(() => {
    const samples: { id: string; text: string; cluster: number }[] = [];
    for (const cid of data.comment_ids) {
      const cd = data.comments_data?.[cid];
      if (cd?.org === entityName && samples.length < 3) {
        const idx = data.comment_ids.indexOf(cid);
        samples.push({
          id: cid,
          text: cd.text?.slice(0, 200) || "",
          cluster: data.labels[idx],
        });
      }
    }
    return samples;
  }, [entityName, data]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 720,
          maxHeight: "85vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-strong)",
          color: "var(--fg-primary)",
          fontFamily: "var(--font-mono)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            background: "var(--bg-header)",
            borderBottom: "1px solid var(--border-header)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: "var(--fg-primary)", fontSize: 11, fontWeight: 700 }}>ENTS</span>
          <span style={{ color: "#FFFFFF", fontSize: 13, letterSpacing: "0.05em", flex: 1 }}>
            {entityName.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: INTENSITY_COLORS[info.intensity] || "var(--fg-primary)",
              padding: "2px 6px",
              border: `1px solid ${INTENSITY_COLORS[info.intensity] || "var(--fg-primary)"}`,
            }}
          >
            {info.intensity.replace("_", " ").toUpperCase()}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: "var(--fg-primary)",
              cursor: "pointer",
              fontSize: 11,
              padding: "1px 8px",
              fontFamily: "var(--font-mono)",
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: "14px 16px" }}>
          {/* Top stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Stat label="SECTOR" value={info.sector} />
            <Stat label="TYPE" value={info.type} />
            <Stat label="ANNUAL LOBBY" value={info.annual_lobby} cls="cyan" />
            <Stat label="MATCHES" value={(totalComments * 8).toLocaleString()} cls="red" />
          </div>

          {/* Why this matched */}
          <div style={{ marginBottom: 14 }}>
            <div className="dl-doc-stat-label" style={{ marginBottom: 4 }}>WHY THIS ENTITY WAS MATCHED</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--fg-secondary)",
                lineHeight: 1.5,
                padding: 8,
                background: "var(--bg-panel-alt)",
                border: "1px solid var(--border-default)",
              }}
            >
              {info.why}
            </div>
          </div>

          {/* Clusters dominated */}
          <div style={{ marginBottom: 14 }}>
            <div className="dl-doc-stat-label" style={{ marginBottom: 4 }}>
              DOMINATES {clusterMatches.length} CLUSTERS
            </div>
            <div style={{ border: "1px solid var(--border-default)" }}>
              {clusterMatches.length === 0 ? (
                <div style={{ padding: 8, color: "var(--fg-muted)", fontSize: 10 }}>
                  No clusters currently linked to this entity.
                </div>
              ) : (
                clusterMatches.map((cm) => (
                  <div
                    key={cm.cluster_id}
                    onClick={() => {
                      onSelectCluster(cm.cluster_id);
                      onClose();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 8px",
                      borderBottom: "1px solid var(--border-default)",
                      cursor: "pointer",
                      fontSize: 10,
                    }}
                  >
                    <span style={{ width: 50, color: "var(--data-link)", fontWeight: 700 }}>
                      CLUS {cm.cluster_id}
                    </span>
                    <div style={{ flex: 1, height: 6, background: "var(--border-default)" }}>
                      <div
                        style={{
                          width: `${cm.pct * 100}%`,
                          height: "100%",
                          background:
                            cm.pct > 0.6 ? "#FF3B3B" : cm.pct > 0.3 ? "#FFB800" : "#FFA028",
                        }}
                      />
                    </div>
                    <span style={{ width: 60, textAlign: "right", color: "var(--fg-primary)", fontVariantNumeric: "tabular-nums" }}>
                      {(cm.count * 8).toLocaleString()}
                    </span>
                    <span style={{ width: 40, textAlign: "right", color: "var(--fg-muted)" }}>
                      {(cm.pct * 100).toFixed(0)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sample comments */}
          {sampleComments.length > 0 && (
            <div>
              <div className="dl-doc-stat-label" style={{ marginBottom: 4 }}>SAMPLE COMMENTS</div>
              {sampleComments.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: 8,
                    background: "var(--bg-panel-alt)",
                    border: "1px solid var(--border-default)",
                    marginBottom: 6,
                    fontSize: 10,
                    color: "var(--fg-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontSize: 8, color: "var(--fg-muted)", marginBottom: 3 }}>
                    CLUS {s.cluster} · {s.id}
                  </div>
                  {s.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="dl-doc-stat-label">{label}</div>
      <div className={`dl-doc-stat-value ${cls || ""}`} style={{ fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}
