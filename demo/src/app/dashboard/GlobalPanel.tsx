"use client";

import { useMemo } from "react";
import type { DashboardData } from "./types";
import WorldMap from "./WorldMap";

interface Props {
  data: DashboardData;
  selectedCountry?: string | null;
  onSelectCountry?: (iso2: string) => void;
}

const COUNTRY_INFO: Record<string, { name: string; risk: string; iso3: string; region: string }> = {
  US: { name: "United States", risk: "baseline", iso3: "USA", region: "North America" },
  RU: { name: "Russia", risk: "high", iso3: "RUS", region: "Eastern Europe" },
  CN: { name: "China", risk: "high", iso3: "CHN", region: "East Asia" },
  IR: { name: "Iran", risk: "high", iso3: "IRN", region: "Middle East" },
  KP: { name: "North Korea", risk: "critical", iso3: "PRK", region: "East Asia" },
  VE: { name: "Venezuela", risk: "high", iso3: "VEN", region: "South America" },
  BY: { name: "Belarus", risk: "high", iso3: "BLR", region: "Eastern Europe" },
  TR: { name: "Turkey", risk: "medium", iso3: "TUR", region: "Middle East" },
};

const RISK_COLORS: Record<string, string> = {
  baseline: "#00D26A",
  medium: "#FFB800",
  high: "#FF3B3B",
  critical: "#FF1A1A",
};

export default function GlobalPanel({ data, selectedCountry, onSelectCountry }: Props) {
  const countries = useMemo(() => {
    const dist = data.country_distribution || {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        code,
        info: COUNTRY_INFO[code] || { name: code, risk: "medium", iso3: code, region: "Unknown" },
        count,
        pct: (count / total) * 100,
      }));
  }, [data.country_distribution]);

  const foreign = countries.filter((c) => c.code !== "US");
  const foreignTotal = foreign.reduce((s, c) => s + c.count, 0);
  const grandTotal = countries.reduce((s, c) => s + c.count, 0);
  const maxForeign = Math.max(...foreign.map((c) => c.count), 1);
  const flaggedCount = foreign.filter((c) => c.info.risk === "high" || c.info.risk === "critical").length;

  return (
    <div className="dl-panel dl-global">
      <div className="dl-panel-header">
        <span className="dl-panel-code">GLOB</span>
        <span className="dl-panel-title">GLOBAL ORIGIN ANALYSIS · NON-US IP TRACES</span>
        <span className="dl-panel-meta">{foreign.length} FOREIGN · {flaggedCount} FLAGGED</span>
      </div>
      <div className="dl-panel-body" style={{ padding: "8px 12px", display: "flex", gap: 14 }}>
        {/* World map */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <WorldMap
            distribution={data.country_distribution || {}}
            highlighted={foreign.filter((c) => c.info.risk === "high" || c.info.risk === "critical").map((c) => c.code)}
            selectedCountry={selectedCountry}
            onSelectCountry={onSelectCountry}
          />
        </div>

        {/* Right column: stats + list */}
        <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        {/* Top stats — 4 KPIs compact */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 2 }}>
          <div>
            <div className="dl-doc-stat-label" style={{ fontSize: 7 }}>DOMESTIC</div>
            <div className="dl-doc-stat-value" style={{ color: "var(--data-positive)", fontSize: 13 }}>
              {(((countries.find((c) => c.code === "US")?.count || 0) / grandTotal) * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="dl-doc-stat-label" style={{ fontSize: 7 }}>FOREIGN</div>
            <div className="dl-doc-stat-value" style={{ color: "var(--data-negative)", fontSize: 13 }}>
              {((foreignTotal / grandTotal) * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="dl-doc-stat-label" style={{ fontSize: 7 }}>FLAGGED</div>
            <div className="dl-doc-stat-value" style={{ color: "var(--data-negative)", fontSize: 13 }}>
              {flaggedCount}
            </div>
          </div>
          <div>
            <div className="dl-doc-stat-label" style={{ fontSize: 7 }}>NATIONS</div>
            <div className="dl-doc-stat-value" style={{ fontSize: 13 }}>{countries.length}</div>
          </div>
        </div>

        {/* Country list */}
        <div className="dl-doc-stat-label" style={{ marginBottom: 4 }}>NON-US ORIGINS BY VOLUME</div>
        <div style={{ borderTop: "1px solid var(--border-default)" }}>
          {foreign.map((c) => (
            <div
              key={c.code}
              onClick={() => onSelectCountry?.(c.code)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 4px",
                borderBottom: "1px solid var(--border-default)",
                fontSize: 10,
                cursor: "pointer",
                background: selectedCountry === c.code ? "var(--bg-selected)" : "transparent",
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 12,
                  background: RISK_COLORS[c.info.risk],
                  flexShrink: 0,
                }}
              />
              <span style={{ width: 26, color: "var(--data-link)", fontWeight: 700 }}>{c.info.iso3}</span>
              <span
                style={{
                  flex: 1,
                  color: "var(--fg-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.info.name}
              </span>
              <div style={{ width: 60, height: 4, background: "var(--border-default)", flexShrink: 0 }}>
                <div
                  style={{
                    width: `${Math.min(100, (c.count / maxForeign) * 100)}%`,
                    height: "100%",
                    background: RISK_COLORS[c.info.risk],
                  }}
                />
              </div>
              <span
                style={{
                  width: 44,
                  textAlign: "right",
                  color: "var(--fg-primary)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {(c.count * 8).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Footer warning */}
        <div
          style={{
            marginTop: 4,
            padding: "5px 7px",
            background: "rgba(255, 59, 59, 0.08)",
            border: "1px solid rgba(255, 59, 59, 0.3)",
            color: "var(--data-negative)",
            fontSize: 9,
            lineHeight: 1.45,
          }}
        >
          ⚠ <strong>STATE ACTOR SIGNATURE.</strong> {(foreignTotal * 8).toLocaleString()} non-US IP origins. Concentrated in clusters #19, #39, #47.
        </div>
        </div>
      </div>
    </div>
  );
}
