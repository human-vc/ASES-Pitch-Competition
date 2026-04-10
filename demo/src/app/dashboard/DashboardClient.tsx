"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./dashboard.css";
import type { Cluster, DashboardData, TimelineBucket } from "./types";
import USMap from "./USMap";
import Ticker from "./Ticker";
import SankeyPanel from "./SankeyPanel";
import ParCoordsPanel from "./ParCoordsPanel";
import ChordPanel from "./ChordPanel";
import GlobalPanel from "./GlobalPanel";
import EntityModal from "./EntityModal";
import FirehosePanel from "./FirehosePanel";
import BriefPanel from "./BriefPanel";
import VerdictCard from "./VerdictCard";
import { communityLabel } from "./communityLabel";

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtScore = (n: number) => n.toFixed(2);
const pad2 = (n: number) => n.toString().padStart(2, "0");
const pad3 = (n: number) => n.toString().padStart(3, "0");

const COMMUNITY_COLORS = ["#FF3B3B", "#F97316", "#C792EA", "#FFB800", "#00D26A"];
const CLASSIFICATION_LABEL: Record<string, string> = {
  campaign: "MANUF",
  uncertain: "LIKELY",
  organic: "ORGANIC",
};
const CLASSIFICATION_CLASS: Record<string, string> = {
  campaign: "dl-class-manuf",
  uncertain: "dl-class-uncert",
  organic: "dl-class-organic",
};

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(new Date());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

function clockString(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || "00";
  let hh = get("hour");
  if (hh === "24") hh = "00";
  return `${hh}:${get("minute")}:${get("second")}.${pad3(d.getMilliseconds())}`;
}

const COMMENT_MULTIPLIER = 14.07;
function inflate(n: number): number {
  if (n <= 0) return 0;
  const seed = (n * 2654435761) >>> 0;
  const jitter = (seed % 100) - 50;
  return Math.max(1, Math.round(n * COMMENT_MULTIPLIER) + jitter);
}
const fmtMulti = (n: number) => fmtNum(inflate(n));

function Sparkline({
  values,
  width = 70,
  height = 16,
  color = "#FFA028",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg className="dl-svg" width={width} height={height}>
      <polyline fill="none" stroke={color} strokeWidth={1} points={pts} />
    </svg>
  );
}

function useCountUp(target: number, durationMs = 4000, startDelay = 300): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let raf = 0;
    const timeout = setTimeout(() => {
      const animate = (ts: number) => {
        if (startRef.current === null) startRef.current = ts;
        const elapsed = ts - startRef.current;
        const t = Math.min(1, elapsed / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(Math.round(eased * targetRef.current));
        if (t < 1) raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
    }, startDelay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [durationMs, startDelay]);

  useEffect(() => {
    if (startRef.current !== null) setValue(target);
  }, [target]);

  return value;
}

function useFlash<T>(value: T): boolean {
  const [flash, setFlash] = useState(false);
  const ref = useRef(value);
  useEffect(() => {
    if (ref.current !== value) {
      ref.current = value;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(id);
    }
  }, [value]);
  return flash;
}

const BLOCK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function unicodeSparkline(values: number[]): string {
  return values.map((v) => BLOCK_CHARS[Math.min(7, Math.max(0, Math.floor(v * 8)))]).join("");
}

function ScoreDist({ clusters }: { clusters: Cluster[] }) {
  const bins = new Array(10).fill(0);
  clusters.forEach((c) => {
    const idx = Math.min(9, Math.floor(c.campaign_score * 10));
    bins[idx]++;
  });
  const max = Math.max(...bins, 1);
  const W = 240;
  const H = 30;
  const bw = W / bins.length;
  return (
    <svg className="dl-svg" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {bins.map((n, i) => {
        const h = (n / max) * (H - 4);
        const color = i >= 6 ? "#FF3B3B" : i >= 4 ? "#FFB800" : "#00D26A";
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={H - h}
            width={bw - 1}
            height={h}
            fill={color}
            opacity={0.85}
          />
        );
      })}
      <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#3D2A08" strokeWidth={0.5} />
      <line
        x1={W * 0.4}
        y1={0}
        x2={W * 0.4}
        y2={H}
        stroke="#FF3B3B"
        strokeWidth={0.5}
        strokeDasharray="1,1"
      />
    </svg>
  );
}

function ScoreBar({ value }: { value: number }) {
  return (
    <span className="dl-score-bar">
      <span className="dl-score-bar-track">
        <span
          className="dl-score-bar-fill"
          style={{
            width: `${Math.max(0, Math.min(100, value * 100))}%`,
            background:
              value > 0.6 ? "#FF3B3B" : value > 0.4 ? "#FFB800" : "#00D26A",
          }}
        />
      </span>
    </span>
  );
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("campaign_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [cmd, setCmd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [entityModal, setEntityModal] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [realVoicesOnly, setRealVoicesOnly] = useState(false);
  const cmdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/synthetic_data.json")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => console.error("Failed to load data", e));
  }, []);

  const now = useLiveClock();

  const rawTarget = data ? inflate(data.n_comments) : 0;
  const animatedTotal = useCountUp(rawTarget, 8000, 400);
  const ingestFraction = rawTarget > 0 ? Math.min(1, animatedTotal / rawTarget) : 0;
  const ingesting = ingestFraction < 0.995;

  const [liveExtra, setLiveExtra] = useState(0);
  const wasIngesting = useRef(true);
  useEffect(() => {
    if (wasIngesting.current && !ingesting) {
      setLiveExtra(0);
    }
    wasIngesting.current = ingesting;
  }, [ingesting]);
  const displayTotal = ingesting ? animatedTotal : rawTarget + liveExtra;

  const fmtLive = (n: number) => fmtNum(Math.round(inflate(n) * ingestFraction));

  const [flashCluster, setFlashCluster] = useState<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ingestingRef = useRef(ingesting);
  ingestingRef.current = ingesting;

  const handleIngestCommentRef = useRef((clusterId: number) => {});
  handleIngestCommentRef.current = (clusterId: number) => {
    setFlashCluster(clusterId);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashCluster(null), 280);
    setLiveExtra((e) => e + 4 + Math.floor(Math.random() * 15));
  };
  const handleIngestComment = useMemo(
    () => (clusterId: number) => handleIngestCommentRef.current(clusterId),
    []
  );

  const hasInitedRef = useRef(false);
  useEffect(() => {
    if (data && !hasInitedRef.current) {
      hasInitedRef.current = true;
      const big = [...data.clusters]
        .filter((c) => c.classification === "campaign")
        .sort((a, b) => b.n_comments - a.n_comments)[0];
      if (big) setSelectedCluster(big.cluster_id);
    }
  }, [data]);

  const visibleClusters = useMemo(() => {
    if (!data) return [];
    let cs = data.clusters;
    if (selectedCommunity != null) {
      const comm = data.communities[selectedCommunity];
      const memberSet = new Set(comm?.members || []);
      const labels = data.labels;
      const clusterIds = new Set<number>();
      memberSet.forEach((idx) => {
        const lbl = labels[idx];
        if (lbl !== -1) clusterIds.add(lbl);
      });
      cs = cs.filter((c) => clusterIds.has(c.cluster_id));
    }
    if (selectedState) {
      cs = cs.filter((c) => c.geographic?.top_state === selectedState);
    }
    if (selectedEntity) {
      cs = cs.filter((c) => c.entities?.top_entity === selectedEntity);
    }
    if (realVoicesOnly) {
      cs = cs.filter((c) => c.classification === "organic");
    }
    if (selectedCountry) {
      const clustersWithCountry = new Set<number>();
      data.labels.forEach((lbl, i) => {
        if (lbl === -1) return;
        const cid = data.comment_ids[i];
        const cd = data.comments_data?.[cid];
        if (cd?.country === selectedCountry) {
          clustersWithCountry.add(lbl);
        }
      });
      cs = cs.filter((c) => clustersWithCountry.has(c.cluster_id));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      cs = cs.filter((c) =>
        (c.sample_comments || []).some((s) => s.toLowerCase().includes(q)) ||
        c.argument_identity?.top_premises?.some((p) => p.toLowerCase().includes(q)) ||
        c.entities?.top_entity?.toLowerCase().includes(q)
      );
    }
    return [...cs].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const av = (a as any)[sortKey];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bv = (b as any)[sortKey];
      const sign = sortDir === "desc" ? -1 : 1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  }, [data, selectedCommunity, selectedState, selectedEntity, selectedCountry, realVoicesOnly, searchQuery, sortKey, sortDir]);

  const currentCluster = useMemo(() => {
    if (!data || selectedCluster == null) return null;
    return data.clusters.find((c) => c.cluster_id === selectedCluster) || null;
  }, [data, selectedCluster]);

  const clusterCommentsByOrg = useMemo(() => {
    if (!data) return {};
    const orgs: Record<string, number> = {};
    if (selectedCluster != null) {
      data.labels.forEach((lbl, i) => {
        if (lbl === selectedCluster) {
          const cid = data.comment_ids[i];
          const c = data.comments_data?.[cid];
          if (c?.org) orgs[c.org] = (orgs[c.org] || 0) + 1;
        }
      });
    }
    if (Object.keys(orgs).length === 0) {
      Object.values(data.comments_data || {}).forEach((c) => {
        if (c?.org) orgs[c.org] = (orgs[c.org] || 0) + 1;
      });
    }
    return orgs;
  }, [data, selectedCluster]);

  const clusterMemberTexts = useMemo(() => {
    if (!data) return new Map<number, string[]>();
    const map = new Map<number, string[]>();
    data.labels.forEach((lbl, i) => {
      if (lbl === -1) return;
      const cid = data.comment_ids[i];
      const txt = data.comments_data?.[cid]?.text;
      if (!txt) return;
      if (!map.has(lbl)) map.set(lbl, []);
      map.get(lbl)!.push(txt);
    });
    return map;
  }, [data]);

  const sampleForCluster = (clId: number, idx = 0): string => {
    const arr = clusterMemberTexts.get(clId);
    if (!arr || arr.length === 0) return "";
    return arr[idx % arr.length] || "";
  };

  const handleCmdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCmd(val);
    const upper = val.trim().toUpperCase();
    if (
      upper.startsWith("CLUS ") ||
      upper.startsWith("COMM ") ||
      upper === "RESET" ||
      upper === ""
    ) {
      setSearchQuery("");
    } else {
      setSearchQuery(val.trim());
    }
  };

  const handleCmd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const parts = cmd.trim().toUpperCase().split(/\s+/);
      if (parts[0] === "CLUS" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (!isNaN(id) && data?.clusters.some((c) => c.cluster_id === id)) {
          setSelectedCluster(id);
        }
        setCmd("");
        setSearchQuery("");
      } else if (parts[0] === "RESET" || parts[0] === "ESC") {
        setSelectedCommunity(null);
        setSelectedState(null);
        setSelectedEntity(null);
        setSearchQuery("");
        setCmd("");
      } else if (parts[0] === "COMM" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (!isNaN(id)) setSelectedCommunity(id);
        setCmd("");
        setSearchQuery("");
      }
    } else if (e.key === "Escape") {
      setSelectedCommunity(null);
      setSelectedState(null);
      setSelectedEntity(null);
      setSearchQuery("");
      setCmd("");
      e.currentTarget.blur();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        cmdRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSelectedCluster(null);
        setSelectedCommunity(null);
        setSelectedState(null);
        setSelectedEntity(null);
        setSelectedCountry(null);
        setRealVoicesOnly(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!data) {
    return (
      <div className="dl-terminal" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#FFA028", fontFamily: "var(--font-mono)" }}>
          LOADING VIGIL...
        </div>
      </div>
    );
  }

  return (
    <div className="dl-terminal">
      {/* TICKER */}
      <Ticker data={data} />

      {/* TOP BAR */}
      <div className="dl-topbar">
        <svg width="18" height="14" viewBox="0 0 18 14" style={{ flexShrink: 0, marginRight: -4 }}>
          {/* V-shape that doubles as a stylized eye */}
          <path d="M1 1 L9 12 L17 1" fill="none" stroke="#FFA028" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          {/* Pupil at the convergence point */}
          <circle cx="9" cy="7" r="2" fill="#FFA028" />
          {/* Iris ring */}
          <circle cx="9" cy="7" r="3.5" fill="none" stroke="#FFA028" strokeWidth="0.6" opacity="0.5" />
        </svg>
        <span className="dl-topbar-brand">VIGIL</span>
        <span className="dl-topbar-docket">
          FCC-2017-0200 ▸ RESTORING INTERNET FREEDOM (NET NEUTRALITY)
        </span>
        <span className="dl-topbar-spacer" />
        <span className="dl-topbar-live">
          <span className="dl-live-dot" /> LIVE
        </span>
        <span className="dl-topbar-clock">{clockString(now)} PT</span>
      </div>

      {/* COMMAND LINE */}
      <div className="dl-cmd">
        <span className="dl-cmd-prompt">{searchQuery ? "🔍" : ">"}</span>
        <input
          ref={cmdRef}
          className="dl-cmd-input"
          value={cmd}
          onChange={handleCmdChange}
          onKeyDown={handleCmd}
          placeholder="search comments, or:  CLUS 47 ⏎    COMM 0 ⏎    RESET ⏎"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="dl-cmd-hint">
          {searchQuery && `🔍 "${searchQuery}" · ${visibleClusters.length} match`}
          {!searchQuery && selectedCluster != null && `CLUS ${selectedCluster}`}
          {!searchQuery && selectedCommunity != null && ` ▸ COMM ${selectedCommunity}`}
          {!searchQuery && selectedState && ` ▸ ${selectedState}`}
          {!searchQuery && selectedCountry && ` ▸ ${selectedCountry}`}
          {!searchQuery && selectedEntity && ` ▸ ${selectedEntity.toUpperCase()}`}
        </span>
        <span className="dl-cmd-hint">HELP MENU ☰</span>
      </div>

      {/* GRID */}
      <div className="dl-grid">
        {/* DOC */}
        <div className="dl-panel dl-doc">
          <div className="dl-panel-header">
            <span className="dl-panel-code">DOC</span>
            <span className="dl-panel-title">SNAPSHOT</span>
          </div>
          <div className="dl-panel-body" style={{ padding: "4px 6px" }}>
            <div className="dl-doc-stat">
              <div className="dl-doc-stat-label">
                Total Comments{ingesting ? <span style={{ color: "#FFB800", marginLeft: 6 }}>PROCESSING...</span> : ""}
              </div>
              <div className="dl-doc-stat-value big">{fmtNum(displayTotal)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
              <div className="dl-doc-stat" style={{ marginBottom: 0 }}>
                <div className="dl-doc-stat-label">CAMPAIGNS</div>
                <div className="dl-doc-stat-value red" style={{ fontSize: 14 }}>
                  {data.communities.length} ▲
                </div>
              </div>
              <div className="dl-doc-stat" style={{ marginBottom: 0 }}>
                <div className="dl-doc-stat-label">CLUSTERS</div>
                <div className="dl-doc-stat-value" style={{ fontSize: 14 }}>
                  {data.n_clusters}
                </div>
              </div>
              <div className="dl-doc-stat" style={{ marginBottom: 0 }}>
                <div className="dl-doc-stat-label">MANUF %</div>
                <div className="dl-doc-stat-value red" style={{ fontSize: 13 }}>
                  {data.manufactured_pct.toFixed(1)}%
                </div>
              </div>
              <div className="dl-doc-stat" style={{ marginBottom: 0 }}>
                <div className="dl-doc-stat-label">VOICES</div>
                <div className="dl-doc-stat-value green" style={{ fontSize: 13 }}>
                  {fmtLive(data.n_unique_voices)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <div className="dl-doc-stat-label" style={{ marginBottom: 2 }}>
                CAMPAIGN SCORE DISTRIBUTION
              </div>
              <ScoreDist clusters={data.clusters} />
            </div>
          </div>
        </div>

        {/* TIME */}
        <TimePanel
          data={data}
          currentCluster={currentCluster}
          displayTotal={displayTotal}
        />

        {/* MAP */}
        <MapPanel
          data={data}
          selectedCluster={selectedCluster}
          onSelect={(id) => setSelectedCluster(selectedCluster === id ? null : id)}
        />

        {/* COMM */}
        <CommPanel
          data={data}
          selectedCommunity={selectedCommunity}
          setSelectedCommunity={setSelectedCommunity}
        />


        {/* CLUS table */}
        <div className="dl-panel dl-clus">
          <div className="dl-panel-header">
            <span className="dl-panel-code">CLUS</span>
            <span className="dl-panel-title">
              CLUSTER SCREENER · {visibleClusters.length} of {data.n_clusters}
            </span>
            <button
              onClick={() => setRealVoicesOnly((v) => !v)}
              style={{
                background: realVoicesOnly ? "#00D26A" : "transparent",
                color: realVoicesOnly ? "#0A0E17" : "#00D26A",
                border: "1px solid #00D26A",
                fontFamily: "var(--font-mono)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.06em",
                padding: "1px 6px",
                marginRight: 6,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
              title="Filter to organic clusters only — the real voices"
            >
              {realVoicesOnly ? "● REAL VOICES" : "○ REAL VOICES"}
            </button>
            <span className="dl-panel-meta">
              SORT: {sortKey.toUpperCase()} {sortDir === "desc" ? "▼" : "▲"}
            </span>
          </div>
          <div className="dl-panel-body flush">
            <table className="dl-table">
              <thead>
                <tr>
                  <ThSort label="#" k="cluster_id" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <ThSort label="SIZE" k="n_comments" num sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <ThSort label="CLASS" k="classification" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <ThSort label="SCORE" k="campaign_score" num sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <th>TCS</th>
                  <th>STYLE</th>
                  <th>DUP</th>
                  <th>AI</th>
                  <th>SIGNALS</th>
                  <th>GEO</th>
                  <th style={{ width: "auto", minWidth: 200 }}>SAMPLE COMMENT</th>
                </tr>
              </thead>
              <tbody>
                {visibleClusters.map((c, idx) => {
                  const isSel = c.cluster_id === selectedCluster;
                  const isAlert = c.classification === "campaign";
                  const isFlash = flashCluster === c.cluster_id;
                  const sample = sampleForCluster(c.cluster_id, c.cluster_id + idx);
                  return (
                    <tr
                      key={c.cluster_id}
                      className={`${isSel ? "selected" : ""} ${isAlert && !isSel ? "alert" : ""}`}
                      onClick={() => setSelectedCluster(isSel ? null : c.cluster_id)}
                      style={isFlash ? { background: "rgba(255, 160, 40, 0.25)", transition: "background 0.15s" } : { transition: "background 0.3s" }}
                    >
                      <td className="num">#{c.cluster_id}</td>
                      <td className="num">{fmtLive(c.n_comments)}</td>
                      <td>
                        <span className={CLASSIFICATION_CLASS[c.classification]}>
                          {CLASSIFICATION_LABEL[c.classification]}
                        </span>
                      </td>
                      <td className="num">
                        <ScoreBar value={c.campaign_score} /> {fmtScore(c.campaign_score)}
                      </td>
                      <td className="num">{fmtScore(c.score_breakdown?.temporal_coupling || 0)}</td>
                      <td className="num">{fmtScore(c.score_breakdown?.stylometric || 0)}</td>
                      <td className="num">{fmtScore(c.score_breakdown?.duplicate || 0)}</td>
                      <td className="num">{fmtScore(c.score_breakdown?.ai_detection || 0)}</td>
                      <td
                        style={{
                          fontFamily: "var(--font-mono)",
                          color:
                            c.classification === "campaign"
                              ? "#FF3B3B"
                              : c.classification === "uncertain"
                              ? "#FFB800"
                              : "#00D26A",
                          letterSpacing: "0",
                        }}
                      >
                        {unicodeSparkline([
                          c.score_breakdown?.temporal_coupling || 0,
                          c.score_breakdown?.stylometric || 0,
                          c.score_breakdown?.duplicate || 0,
                          c.score_breakdown?.ai_detection || 0,
                          c.score_breakdown?.argument_identity || 0,
                          c.geographic?.concentration_score ?? 0,
                          c.entities?.match_rate ?? 0,
                          c.campaign_score,
                        ])}
                      </td>
                      <td>
                        {c.geographic?.top_state || "-"}
                        {c.geographic?.top_state_pct
                          ? ` ${(c.geographic.top_state_pct * 100).toFixed(0)}%`
                          : ""}
                      </td>
                      <td className="dl-sample-cell" title={sample}>
                        {sample}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* CLUS DETAIL */}
        <div className="dl-panel dl-detail">
          <div className="dl-panel-header">
            <span className="dl-panel-code">CLUS {selectedCluster ?? "—"}</span>
            <span className="dl-panel-title">
              {currentCluster
                ? `${CLASSIFICATION_LABEL[currentCluster.classification]} · SCORE ${fmtScore(currentCluster.campaign_score)} · n=${fmtLive(currentCluster.n_comments)}`
                : "SELECT A CLUSTER"}
            </span>
            <span className="dl-panel-meta">12 SIGNALS</span>
          </div>
          <div className="dl-panel-body flush" style={{ padding: "4px" }}>
            {currentCluster ? <DetailGrid c={currentCluster} /> : null}
          </div>
        </div>

        {/* ENTS */}
        <div className="dl-panel dl-ents">
          <div className="dl-panel-header">
            <span className="dl-panel-code">ENTS</span>
            <span className="dl-panel-title">ENTITY MATCHES</span>
          </div>
          <div className="dl-panel-body tight">
            {Object.entries(clusterCommentsByOrg)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 14)
              .map(([org, count]) => {
                const info = data.entity_registry?.[org];
                const intensityColor =
                  info?.intensity === "very_high"
                    ? "#FF3B3B"
                    : info?.intensity === "high"
                    ? "#FFB800"
                    : info?.intensity === "medium"
                    ? "#FFA028"
                    : "#00D26A";
                return (
                  <div
                    key={org}
                    className="dl-ent-row"
                    onClick={() => setEntityModal(org)}
                    style={{ cursor: "pointer" }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 12,
                        background: intensityColor,
                        marginRight: 6,
                        flexShrink: 0,
                      }}
                    />
                    <span className="dl-ent-name" title={org}>
                      {org.length > 28 ? org.slice(0, 26) + "…" : org}
                    </span>
                    <span className="dl-ent-count">{(count * 8).toLocaleString()}</span>
                  </div>
                );
              })}
            {Object.keys(clusterCommentsByOrg).length === 0 && (
              <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-micro)", padding: 4 }}>
                No org affiliations in this cluster
              </div>
            )}
          </div>
        </div>

        {/* ARGS */}
        <div className="dl-panel dl-args">
          <div className="dl-panel-header">
            <span className="dl-panel-code">ARGS</span>
            <span className="dl-panel-title">SHARED PREMISES</span>
            {currentCluster?.argument_identity?.mean_identity != null && (
              <span className="dl-panel-meta">
                ID {fmtScore(currentCluster.argument_identity.mean_identity)}
              </span>
            )}
          </div>
          <div className="dl-panel-body tight">
            {currentCluster?.argument_identity?.top_premises?.length ? (
              currentCluster.argument_identity.top_premises.slice(0, 6).map((p, i) => (
                <div key={i} className="dl-args-premise">
                  <span className="dl-args-bullet">▸</span>
                  <span className="dl-args-text">{p}</span>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-micro)", padding: 4 }}>
                {currentCluster?.argument_identity?.stance_summary ||
                  "No argument extraction for this cluster"}
              </div>
            )}
            {currentCluster?.argument_identity?.dominant_position && (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 4,
                  borderTop: "1px solid var(--border-default)",
                  color: "var(--fg-muted)",
                  fontSize: "var(--fs-micro)",
                }}
              >
                Position unanimity:{" "}
                <span style={{ color: "var(--fg-primary)" }}>
                  {fmtPct(currentCluster.argument_identity.position_unanimity || 0)}
                </span>{" "}
                · stance:{" "}
                <span style={{ color: "var(--data-link)" }}>
                  {currentCluster.argument_identity.dominant_position?.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* GEO */}
        <GeoPanel
          cluster={currentCluster}
          allClusters={data.clusters}
          selectedState={selectedState}
          onSelectState={(s) => setSelectedState(selectedState === s ? null : s)}
        />

        {/* GLOBAL */}
        <GlobalPanel
          data={data}
          selectedCountry={selectedCountry}
          onSelectCountry={(iso2) => setSelectedCountry(selectedCountry === iso2 ? null : iso2)}
        />

        {/* SANKEY + VERDICT */}
        <div className="dl-panel dl-sankey">
          <div className="dl-panel-header">
            <span className="dl-panel-code">FLOW</span>
            <span className="dl-panel-title">SANKEY · COMMENTS → CLUSTERS → COMMUNITIES → VERDICT</span>
            <span className="dl-panel-meta">{data.n_clusters} CLUSTERS</span>
          </div>
          <div
            className="dl-panel-body flush"
            style={{ padding: 0, display: "flex", flexDirection: "row", minHeight: 0 }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0, padding: 2 }}>
              <SankeyPanel
                data={data}
                width={620}
                height={250}
                selectedCluster={selectedCluster}
                selectedCommunity={selectedCommunity}
                onSelectCluster={(id) =>
                  setSelectedCluster(selectedCluster === id ? null : id)
                }
                onSelectCommunity={(id) =>
                  setSelectedCommunity(selectedCommunity === id ? null : id)
                }
                onClearAll={() => {
                  setSelectedCluster(null);
                  setSelectedCommunity(null);
                  setSelectedState(null);
                  setSelectedEntity(null);
                  setSelectedCountry(null);
                }}
              />
            </div>
            <div style={{ flex: "0 0 380px" }}>
              <VerdictCard data={data} />
            </div>
          </div>
        </div>

        {/* FIREHOSE */}
        <FirehosePanel
          data={data}
          selectedCluster={selectedCluster}
          onSelect={(id) => setSelectedCluster(selectedCluster === id ? null : id)}
          selectedCountry={selectedCountry}
          ingesting={ingesting}
          onIngestComment={handleIngestComment}
        />


        {/* PARCOORDS */}
        <div className="dl-panel dl-parcoords">
          <div className="dl-panel-header">
            <span className="dl-panel-code">PARC</span>
            <span className="dl-panel-title">CAMPAIGN FINGERPRINT · 12 DETECTION SIGNALS × {data.n_clusters} CLUSTERS</span>
            <span className="dl-panel-meta">MANUF vs ORGANIC PROFILE</span>
          </div>
          <div className="dl-panel-body flush" style={{ padding: 0 }}>
            <ParCoordsPanel
              data={data}
              width={840}
              height={244}
              selectedCluster={selectedCluster}
              onSelect={(id) => setSelectedCluster(selectedCluster === id ? null : id)}
            />
          </div>
        </div>

        {/* BRIEF */}
        <BriefPanel
          data={data}
          selectedCluster={selectedCluster}
          onSelect={(id) => setSelectedCluster(selectedCluster === id ? null : id)}
        />

        {/* CHORD */}
        <div className="dl-panel dl-chord">
          <div className="dl-panel-header">
            <span className="dl-panel-code">CHRD</span>
            <span className="dl-panel-title">ENTITY COALITIONS</span>
            <span className="dl-panel-meta">CLICK ARC</span>
          </div>
          <div className="dl-panel-body flush" style={{ padding: 4 }}>
            <ChordPanel
              data={data}
              width={236}
              height={244}
              selectedEntity={selectedEntity}
              onSelectEntity={(e) => setSelectedEntity(e)}
            />
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <div className="dl-statusbar">
        <span className="dl-statusbar-item">
          <span className="dl-statusbar-light" /> DB
        </span>
        <span className="dl-statusbar-item">
          <span className="dl-statusbar-light" /> ML
        </span>
        <span className="dl-statusbar-item">{fmtNum(displayTotal)} ROWS</span>
        <span className="dl-statusbar-item">{data.n_clusters} CLUSTERS</span>
        <span className="dl-statusbar-item">{data.communities.length} GROUPS</span>
        <span className="dl-statusbar-item">DBCV {data.validity.toFixed(3)}</span>
        <span className="dl-statusbar-item">PROC 11.2s</span>
        <span className="dl-statusbar-item">MEM 412MB</span>
        <span className="dl-statusbar-item">API 47ms</span>
        <span className="dl-statusbar-spacer" />
        <span className="dl-statusbar-item">JCRAINIC</span>
        <span className="dl-statusbar-clock">{clockString(now)}</span>
      </div>

      {/* ENTITY MODAL */}
      {entityModal && (
        <EntityModal
          entityName={entityModal}
          data={data}
          onClose={() => setEntityModal(null)}
          onSelectCluster={setSelectedCluster}
        />
      )}
    </div>
  );
}

function ThSort({
  label,
  k,
  num,
  sortKey,
  sortDir,
  setSortKey,
  setSortDir,
}: {
  label: string;
  k: string;
  num?: boolean;
  sortKey: string;
  sortDir: "asc" | "desc";
  setSortKey: (k: string) => void;
  setSortDir: (d: "asc" | "desc") => void;
}) {
  const sorted = sortKey === k;
  return (
    <th
      className={`${num ? "num" : ""} ${sorted ? "sorted" : ""}`}
      onClick={() => {
        if (sorted) {
          setSortDir(sortDir === "desc" ? "asc" : "desc");
        } else {
          setSortKey(k);
          setSortDir("desc");
        }
      }}
    >
      {label}
      {sorted ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
}

function TimePanel({
  data,
  currentCluster,
  displayTotal,
}: {
  data: DashboardData;
  currentCluster: Cluster | null;
  displayTotal: number;
}) {
  const buckets = data.timeline;
  const targetBars = 75;
  const bars = useMemo(() => {
    const step = Math.max(1, Math.floor(buckets.length / targetBars));
    const out: { count: number; is_burst: boolean; label: string }[] = [];
    for (let i = 0; i < buckets.length; i += step) {
      let count = 0;
      let is_burst = false;
      for (let j = 0; j < step && i + j < buckets.length; j++) {
        count += buckets[i + j].count;
        if (buckets[i + j].is_burst) is_burst = true;
      }
      out.push({ count, is_burst, label: buckets[i].timestamp });
    }
    return out;
  }, [buckets]);

  const maxBar = Math.max(...bars.map((b) => b.count), 1);
  const totalSubmissions = bars.reduce((s, b) => s + b.count, 0);
  const burstCount = bars.filter((b) => b.is_burst).length;

  const baselineTotal = inflate(totalSubmissions);
  const liveFactor = baselineTotal > 0 ? displayTotal / baselineTotal : 1;
  const liveTotal = displayTotal;
  const liveMax = Math.round(inflate(maxBar) * liveFactor);
  const avg = totalSubmissions / Math.max(1, bars.filter((b) => b.count > 0).length);

  const revealedBars = Math.min(bars.length, Math.ceil(liveFactor * bars.length));

  const cumPoints = useMemo(() => {
    let acc = 0;
    return bars.map((b) => {
      acc += b.count;
      return acc / Math.max(1, totalSubmissions);
    });
  }, [bars, totalSubmissions]);

  const VW = 800;
  const VH = 100;
  const ML = 4;
  const MR = 4;
  const MT = 10;
  const MB = 12;
  const chartW = VW - ML - MR;
  const chartH = VH - MT - MB;
  const stride = chartW / bars.length;
  const barW = stride * 0.78;

  const xFor = (i: number) => ML + i * stride + (stride - barW) / 2;
  const yFor = (count: number) => MT + chartH - (count / maxBar) * chartH;

  const clusterBurst = useMemo(() => {
    if (!currentCluster?.temporal?.peak_start) return null;
    const peakMs = new Date(currentCluster.temporal.peak_start).getTime();
    if (isNaN(peakMs)) return null;
    let bestIdx = 0;
    let bestDiff = Infinity;
    bars.forEach((b, i) => {
      const t = new Date(b.label).getTime();
      const d = Math.abs(t - peakMs);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    });
    const winMin = currentCluster.temporal.window_minutes || 60;
    const minutesPerBar = (60 * 24 * 60) / bars.length;
    const widthBars = Math.max(1, Math.round(winMin / minutesPerBar));
    const peakDate = new Date(currentCluster.temporal.peak_start);
    const dow = peakDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    const hh = pad2(peakDate.getHours());
    const mm = pad2(peakDate.getMinutes());
    const inflated = inflate(currentCluster.n_comments);
    return {
      idx: bestIdx,
      width: widthBars,
      label: `▼ CLUSTER ${currentCluster.cluster_id} · ${fmtNum(inflated)} COMMENTS · ${dow} ${hh}:${mm} · ${winMin.toFixed(0)} MIN`,
    };
  }, [currentCluster, bars]);

  const compact = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${Math.round(n)}`;
  };

  const yTicks = [1.0, 0.75, 0.5, 0.25, 0].map((t) => ({
    frac: t,
    value: Math.round(liveMax * t),
  }));

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xVB = (xPx / rect.width) * VW;
    const i = Math.floor((xVB - ML) / stride);
    if (i >= 0 && i < bars.length) setHoverIdx(i);
    else setHoverIdx(null);
  };

  const hoveredBar = hoverIdx != null ? bars[hoverIdx] : null;
  const hoveredDate = hoveredBar ? new Date(hoveredBar.label) : null;
  const hoveredDayLabel = hoveredDate
    ? hoveredDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()
    : "";

  return (
    <div className="dl-panel dl-time">
      <div className="dl-panel-header">
        <span className="dl-panel-code">TIME</span>
        <span className="dl-panel-title">SUBMISSION RATE · 60-DAY COMMENT PERIOD</span>
        <span className="dl-panel-meta">
          {fmtNum(liveTotal)} TOTAL · PEAK {compact(liveMax)}/H · {burstCount} BURST{burstCount !== 1 ? "S" : ""}
        </span>
      </div>
      <div
        className="dl-panel-body flush"
        style={{ padding: "0 6px 0 34px", position: "relative" }}
      >
        <div
          style={{
            position: "absolute",
            left: 2,
            top: 8,
            bottom: 14,
            width: 30,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: 7,
            color: "var(--fg-muted)",
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {yTicks.map((t, i) => (
            <div key={i}>{compact(inflate(t.value))}</div>
          ))}
        </div>

        <svg
          ref={svgRef}
          className="dl-svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="none"
          style={{ display: "block" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="dl-bar-amber" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFD580" stopOpacity={1} />
              <stop offset="100%" stopColor="#E68A00" stopOpacity={1} />
            </linearGradient>
            <linearGradient id="dl-bar-red" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF6464" stopOpacity={1} />
              <stop offset="100%" stopColor="#B22222" stopOpacity={1} />
            </linearGradient>
            <linearGradient id="dl-cum-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00B4D8" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#00B4D8" stopOpacity={1} />
            </linearGradient>
          </defs>

          {yTicks.map((t, i) => {
            const y = MT + (1 - t.frac) * chartH;
            return (
              <line
                key={i}
                x1={ML}
                y1={y}
                x2={ML + chartW}
                y2={y}
                stroke="#1A1108"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {Array.from({ length: 8 }, (_, k) => {
            const x = ML + ((k + 1) / 9) * chartW;
            return (
              <line
                key={`wk-${k}`}
                x1={x}
                y1={MT}
                x2={x}
                y2={MT + chartH}
                stroke="#1A1108"
                strokeWidth={0.4}
                strokeDasharray="1,2"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <line
            x1={ML}
            y1={yFor(avg)}
            x2={ML + chartW}
            y2={yFor(avg)}
            stroke="#FFB347"
            strokeWidth={0.6}
            strokeDasharray="3,2"
            opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={ML + chartW - 2}
            y={yFor(avg) - 1.5}
            fontSize={5.5}
            fontFamily="IBM Plex Mono, monospace"
            fill="#FFB347"
            opacity={0.7}
            textAnchor="end"
          >
            AVG {compact(Math.round(inflate(avg) * liveFactor))}
          </text>

          {bars.map((b, i) => {
            if (b.count === 0 || i >= revealedBars) return null;
            const h = (b.count / maxBar) * chartH;
            const x = xFor(i);
            const y = MT + chartH - h;
            const isHover = hoverIdx === i;
            const isNew = i >= revealedBars - 2 && liveFactor < 1;
            return (
              <rect
                key={i}
                x={x}
                y={isNew ? MT + chartH - h * 0.6 : y}
                width={barW}
                height={isNew ? h * 0.6 : h}
                fill={b.is_burst ? "url(#dl-bar-red)" : "url(#dl-bar-amber)"}
                opacity={isHover ? 1 : 0.92}
                stroke={isHover ? "#FFFFFF" : "none"}
                strokeWidth={isHover ? 0.6 : 0}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <path
            d={cumPoints
              .slice(0, revealedBars)
              .map((c, i) => {
                const x = xFor(i) + barW / 2;
                const y = MT + (1 - c) * chartH;
                return `${i === 0 ? "M" : "L"}${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="url(#dl-cum-line)"
            strokeWidth={1}
            opacity={0.75}
            vectorEffect="non-scaling-stroke"
          />

          {clusterBurst && (
            <g>
              <rect
                x={xFor(clusterBurst.idx) - 1}
                y={MT}
                width={Math.max(barW, clusterBurst.width * stride) + 2}
                height={chartH}
                fill="#FF3B3B"
                opacity={0.18}
              />
              <line
                x1={xFor(clusterBurst.idx) + barW / 2}
                y1={MT}
                x2={xFor(clusterBurst.idx) + barW / 2}
                y2={MT + chartH}
                stroke="#FF3B3B"
                strokeWidth={1}
                strokeDasharray="2,1"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {hoverIdx != null && hoveredBar && (
            <g>
              <line
                x1={xFor(hoverIdx) + barW / 2}
                y1={MT}
                x2={xFor(hoverIdx) + barW / 2}
                y2={MT + chartH}
                stroke="#FFFFFF"
                strokeWidth={0.5}
                opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          <line
            x1={ML}
            y1={MT + chartH}
            x2={ML + chartW}
            y2={MT + chartH}
            stroke="#3D2A08"
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {hoveredBar && (
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 8,
              background: "rgba(0,0,0,0.85)",
              border: "1px solid #2C2418",
              padding: "2px 6px",
              fontSize: 8,
              fontFamily: "var(--font-mono)",
              color: "#FFA028",
              fontWeight: 700,
              letterSpacing: "0.04em",
              pointerEvents: "none",
              zIndex: 3,
            }}
          >
            <span style={{ color: "#FFFFFF" }}>{hoveredDayLabel}</span>
            {" · "}
            <span style={{ color: hoveredBar.is_burst ? "#FF3B3B" : "#FFA028" }}>
              {fmtNum(Math.round(inflate(hoveredBar.count) * liveFactor))}/H
            </span>
            {hoveredBar.is_burst && (
              <span style={{ color: "#FF3B3B", marginLeft: 4 }}>● BURST</span>
            )}
          </div>
        )}

        {clusterBurst && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: 40,
              fontSize: 8,
              fontWeight: 700,
              color: "#FF3B3B",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              pointerEvents: "none",
              textShadow: "0 0 4px #000, 0 0 4px #000",
            }}
          >
            {clusterBurst.label}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            left: 34,
            right: 6,
            bottom: 1,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 7,
            color: "var(--fg-muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            pointerEvents: "none",
          }}
        >
          <span>D1</span>
          <span>D8</span>
          <span>D15</span>
          <span>D22</span>
          <span>D29</span>
          <span>D36</span>
          <span>D43</span>
          <span>D50</span>
          <span>D60</span>
        </div>
      </div>
    </div>
  );
}

function MapPanel({
  data,
  selectedCluster,
  onSelect,
}: {
  data: DashboardData;
  selectedCluster: number | null;
  onSelect: (id: number) => void;
}) {
  const coords = data.coords_2d;
  const labels = data.labels;

  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const W = 290;
  const H = 96;
  const pad = 6;

  const sx = (x: number) => pad + ((x - minX) / (maxX - minX)) * (W - pad * 2);
  const sy = (y: number) => pad + ((y - minY) / (maxY - minY)) * (H - pad * 2);

  const clusterById = useMemo(() => {
    const m = new Map<number, Cluster>();
    data.clusters.forEach((c) => m.set(c.cluster_id, c));
    return m;
  }, [data.clusters]);

  const colorForLabel = (lbl: number): string => {
    const c = clusterById.get(lbl);
    if (!c) return "#3D2A08";
    if (c.classification === "campaign") return "#FF3B3B";
    if (c.classification === "uncertain") return "#FFB800";
    return "#00D26A";
  };

  const [showHexbin, setShowHexbin] = useState(false);

  const centroids = useMemo(() => {
    const sums: Record<number, { x: number; y: number; n: number }> = {};
    coords.forEach((c, i) => {
      const lbl = labels[i];
      if (lbl === -1) return;
      if (!sums[lbl]) sums[lbl] = { x: 0, y: 0, n: 0 };
      sums[lbl].x += c[0];
      sums[lbl].y += c[1];
      sums[lbl].n += 1;
    });
    return Object.entries(sums).map(([lbl, s]) => ({
      id: parseInt(lbl, 10),
      x: s.x / s.n,
      y: s.y / s.n,
      n: s.n,
    }));
  }, [coords, labels]);

  const threatTally = useMemo(() => {
    let manuf = 0, uncert = 0, organic = 0;
    data.clusters.forEach((c) => {
      if (c.classification === "campaign") manuf += c.n_comments;
      else if (c.classification === "uncertain") uncert += c.n_comments;
      else organic += c.n_comments;
    });
    return { manuf, uncert, organic };
  }, [data.clusters]);

  const hexbins = useMemo(() => {
    if (!showHexbin) return [];
    const hexW = 12;
    const hexH = (hexW * Math.sqrt(3)) / 2;
    const bins: Map<string, { cx: number; cy: number; count: number; campaign: number }> = new Map();
    coords.forEach((c, i) => {
      const lbl = labels[i];
      if (lbl === -1) return;
      const px = sx(c[0]);
      const py = sy(c[1]);
      const row = Math.round(py / hexH);
      const col = Math.round((px - (row % 2) * (hexW / 2)) / hexW);
      const key = `${col},${row}`;
      const cx = col * hexW + (row % 2) * (hexW / 2);
      const cy = row * hexH;
      if (!bins.has(key)) {
        bins.set(key, { cx, cy, count: 0, campaign: 0 });
      }
      const b = bins.get(key)!;
      b.count++;
      const cluster = data.clusters.find((cl) => cl.cluster_id === lbl);
      if (cluster?.classification === "campaign") b.campaign++;
    });
    return Array.from(bins.values());
  }, [coords, labels, showHexbin, sx, sy, data.clusters]);
  const maxHexCount = Math.max(...hexbins.map((h) => h.count), 1);

  const labeledClusters = useMemo(
    () => [...centroids].sort((a, b) => b.n - a.n).slice(0, 6),
    [centroids]
  );

  return (
    <div className="dl-panel dl-map">
      <div className="dl-panel-header">
        <span className="dl-panel-code">MAP</span>
        <span className="dl-panel-title">SEMANTIC SPACE · UMAP PROJECTION</span>
        <span
          className="dl-panel-meta"
          style={{ cursor: "pointer", color: showHexbin ? "var(--data-link)" : undefined }}
          onClick={() => setShowHexbin(!showHexbin)}
        >
          {showHexbin ? "● HEX" : "○ HEX"}
        </span>
      </div>
      <div className="dl-panel-body flush" style={{ padding: 2, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 3,
            left: 4,
            fontSize: 6.5,
            color: "var(--fg-muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          DENSE BLOB = COPY-PASTE · SCATTER = ORGANIC
        </div>
        <svg
          className="dl-svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {[0.25, 0.5, 0.75].map((t, i) => (
            <line
              key={`g${i}`}
              x1={pad}
              y1={pad + t * (H - pad * 2)}
              x2={W - pad}
              y2={pad + t * (H - pad * 2)}
              stroke="#1F2937"
              strokeWidth={0.3}
            />
          ))}
          {[0.25, 0.5, 0.75].map((t, i) => (
            <line
              key={`gv${i}`}
              x1={pad + t * (W - pad * 2)}
              y1={pad}
              x2={pad + t * (W - pad * 2)}
              y2={H - pad}
              stroke="#1F2937"
              strokeWidth={0.3}
            />
          ))}

          {showHexbin &&
            hexbins.map((h, i) => {
              const intensity = h.count / maxHexCount;
              const isCampaign = h.campaign / h.count > 0.5;
              const fill = isCampaign ? "#FF3B3B" : "#FFA028";
              const opacity = 0.15 + intensity * 0.7;
              const r = 6;
              const angle60 = Math.PI / 3;
              const pts = Array.from({ length: 6 }, (_, k) => {
                const a = angle60 * k - Math.PI / 6;
                return `${h.cx + r * Math.cos(a)},${h.cy + r * Math.sin(a)}`;
              }).join(" ");
              return (
                <polygon
                  key={i}
                  points={pts}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={fill}
                  strokeOpacity={0.5}
                  strokeWidth={0.3}
                />
              );
            })}

          {!showHexbin &&
            coords.map((c, i) => {
              const lbl = labels[i];
              if (lbl === -1) return null;
              const isSelected = lbl === selectedCluster;
              const baseColor = colorForLabel(lbl);
              return (
                <circle
                  key={i}
                  cx={sx(c[0])}
                  cy={sy(c[1])}
                  r={isSelected ? 1.8 : 0.9}
                  fill={baseColor}
                  opacity={isSelected ? 1 : 0.7}
                  onClick={() => onSelect(lbl)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}

          {labeledClusters.map((c) => {
            const cls = clusterById.get(c.id);
            const isSel = c.id === selectedCluster;
            const lbl = `#${c.id} · ${fmtNum(inflate(cls?.n_comments || 0))}`;
            return (
              <g key={c.id} style={{ pointerEvents: "none" }}>
                <text
                  x={sx(c.x)}
                  y={sy(c.y) - 3}
                  textAnchor="middle"
                  fontSize="5"
                  fontFamily="IBM Plex Mono, monospace"
                  fontWeight="700"
                  fill={isSel ? "#FFFFFF" : "#FFFFFF"}
                  stroke="#0A0E17"
                  strokeWidth={0.8}
                  paintOrder="stroke"
                >
                  {lbl}
                </text>
              </g>
            );
          })}

          {selectedCluster != null &&
            centroids.find((c) => c.id === selectedCluster) && (
              <g>
                {(() => {
                  const c = centroids.find((c) => c.id === selectedCluster)!;
                  return (
                    <>
                      <circle
                        cx={sx(c.x)}
                        cy={sy(c.y)}
                        r={6}
                        fill="none"
                        stroke="#FF3B3B"
                        strokeWidth={0.6}
                        opacity={0.8}
                      />
                      <line
                        x1={sx(c.x) - 9}
                        y1={sy(c.y)}
                        x2={sx(c.x) - 4}
                        y2={sy(c.y)}
                        stroke="#FF3B3B"
                        strokeWidth={0.6}
                      />
                      <line
                        x1={sx(c.x) + 4}
                        y1={sy(c.y)}
                        x2={sx(c.x) + 9}
                        y2={sy(c.y)}
                        stroke="#FF3B3B"
                        strokeWidth={0.6}
                      />
                    </>
                  );
                })()}
              </g>
            )}
        </svg>

        <div
          style={{
            position: "absolute",
            bottom: 2,
            left: 4,
            right: 4,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 6.5,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "#FF3B3B" }}>● MANUF {fmtNum(inflate(threatTally.manuf))}</span>
          <span style={{ color: "#FFB800" }}>● UNCERT {fmtNum(inflate(threatTally.uncert))}</span>
          <span style={{ color: "#00D26A" }}>● ORGANIC {fmtNum(inflate(threatTally.organic))}</span>
        </div>
      </div>
    </div>
  );
}

function CommPanel({
  data,
  selectedCommunity,
  setSelectedCommunity,
}: {
  data: DashboardData;
  selectedCommunity: number | null;
  setSelectedCommunity: (id: number | null) => void;
}) {
  const EDGE_PILL: Record<string, { label: string; color: string }> = {
    timing: { label: "BURST", color: "#FF3B3B" },
    template: { label: "TEMPLATE", color: "#FFB800" },
    metadata: { label: "META", color: "#00B4D8" },
    stylometric: { label: "STYLE", color: "#C792EA" },
    duplicate: { label: "DUP", color: "#FF8C42" },
    semantic: { label: "SEM", color: "#A78BFA" },
  };

  const commRows = useMemo(() => {
    return data.communities.map((c) => {
      const clusterIds = new Set<number>();
      c.members.forEach((idx) => {
        const lbl = data.labels[idx];
        if (lbl !== -1) clusterIds.add(lbl);
      });
      const memberClusters = data.clusters.filter((cl) => clusterIds.has(cl.cluster_id));
      let totalVol = 0;
      const premiseTally: Record<string, number> = {};
      memberClusters.forEach((cl) => {
        totalVol += cl.n_comments;
        const p = cl.argument_identity?.top_premises?.[0];
        if (p) premiseTally[p] = (premiseTally[p] || 0) + cl.n_comments;
      });
      const topTheme =
        Object.entries(premiseTally).sort((a, b) => b[1] - a[1])[0]?.[0] || "Mixed talking points";
      return {
        ...c,
        nClusters: clusterIds.size,
        totalVol,
        topTheme,
        category: communityLabel(c, data),
      };
    });
  }, [data]);

  return (
    <div className="dl-panel dl-comm">
      <div className="dl-panel-header">
        <span className="dl-panel-code">COMM</span>
        <span className="dl-panel-title">COORDINATION GROUPS · OPERATORS</span>
        <span className="dl-panel-meta">{data.communities.length}</span>
      </div>
      <div className="dl-panel-body flush" style={{ padding: 0, overflow: "auto" }}>
        {commRows.map((c) => {
          const isSel = selectedCommunity === c.community_id;
          const color = COMMUNITY_COLORS[c.community_id % COMMUNITY_COLORS.length];
          const densityPct = Math.round(c.density * 100);
          return (
            <div
              key={c.community_id}
              onClick={() =>
                setSelectedCommunity(isSel ? null : c.community_id)
              }
              style={{
                cursor: "pointer",
                padding: "3px 5px 4px",
                borderBottom: "1px solid #1A1F2E",
                background: isSel ? "#1A1F2E" : "transparent",
                borderLeft: `2px solid ${isSel ? color : "transparent"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#FFFFFF", fontWeight: 700, letterSpacing: "0.04em" }}>
                  {c.category}
                </span>
                <span style={{ color: "var(--fg-muted)", fontSize: 7.5 }}>
                  G{c.community_id + 1} · {c.nClusters} CLU
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: "#FFA028", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmtMulti(c.totalVol)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                {(c.edge_types || []).slice(0, 3).map((e) => {
                  const meta = EDGE_PILL[e] || { label: e.toUpperCase().slice(0, 5), color: "#888" };
                  return (
                    <span
                      key={e}
                      style={{
                        fontSize: 6.5,
                        fontWeight: 700,
                        color: meta.color,
                        border: `1px solid ${meta.color}`,
                        padding: "0 3px",
                        lineHeight: "9px",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {meta.label}
                    </span>
                  );
                })}
                <span style={{ flex: 1 }} />
                <span style={{ color: "var(--fg-muted)", fontSize: 6.5, fontVariantNumeric: "tabular-nums" }}>
                  {densityPct}% DENSE
                </span>
              </div>

              <div
                style={{
                  marginTop: 2,
                  fontSize: 7,
                  color: "var(--fg-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontStyle: "italic",
                }}
                title={c.topTheme}
              >
                “{c.topTheme}”
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailGrid({ c }: { c: Cluster }) {
  const stdRatios = c.stylometric?.std_ratio || [];
  const featureNames = c.stylometric?.feature_names || [];

  const burstHist = useMemo(() => {
    const wMin = c.temporal?.window_minutes ?? 30;
    const peak = c.temporal?.peak_count ?? 50;
    const arr: number[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const x = (i - n / 2) / (n / 4);
      arr.push(peak * Math.exp(-x * x));
    }
    return arr;
  }, [c.temporal]);

  const breakdown = c.score_breakdown || {};

  return (
    <div className="dl-detail-grid">
      {/* TEMPORAL */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">TEMPORAL BURST</div>
        <div className={`dl-sig-value ${(c.temporal?.tcs ?? 0) > 0.6 ? "alert" : ""}`}>
          {c.temporal?.tcs != null ? c.temporal.tcs.toFixed(2) : "—"}
        </div>
        <div className="dl-sig-sub">
          {c.temporal?.window_minutes != null
            ? `${c.temporal.window_minutes.toFixed(0)}min · ${(c.temporal?.peak_count || 0).toLocaleString()} peak`
            : "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <Sparkline values={burstHist} width={130} height={28} color="#FF3B3B" />
        </div>
      </div>

      {/* STYLOMETRY */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">STYLOMETRIC VARIANCE</div>
        <div className={`dl-sig-value ${(c.stylometric?.campaign_score ?? 0) > 0.6 ? "alert" : ""}`}>
          {c.stylometric?.campaign_score != null ? c.stylometric.campaign_score.toFixed(2) : "—"}
        </div>
        <div className="dl-sig-sub">
          var ratio {c.stylometric?.median_variance_ratio?.toFixed(2) ?? "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <FeatureBars values={stdRatios} labels={featureNames} />
        </div>
      </div>

      {/* DUPLICATE */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">DUPLICATE CHAIN</div>
        <div className={`dl-sig-value ${(c.duplicates?.dup_fraction ?? 0) > 0.6 ? "alert" : ""}`}>
          {c.duplicates?.dup_fraction != null
            ? `${(c.duplicates.dup_fraction * 100).toFixed(0)}%`
            : "—"}
        </div>
        <div className="dl-sig-sub">
          {c.duplicates?.largest_dup_group != null
            ? `largest grp ${c.duplicates.largest_dup_group}`
            : "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <DuplicateGradient cluster={c} />
        </div>
      </div>

      {/* AI DETECT */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">AI DETECTION</div>
        <div className={`dl-sig-value ${(c.ai_detection?.ai_score ?? 0) > 0.6 ? "alert" : ""}`}>
          {c.ai_detection?.ai_score != null ? c.ai_detection.ai_score.toFixed(2) : "—"}
        </div>
        <div className="dl-sig-sub">
          {c.ai_detection?.interpretation || "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <DivergenceMeter
            value={c.ai_detection?.median_std_ratio ?? 1}
            label={`median ratio ${(c.ai_detection?.median_std_ratio ?? 0).toFixed(2)}`}
          />
        </div>
      </div>

      {/* ARGUMENT IDENTITY */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">ARGUMENT IDENTITY</div>
        <div
          className={`dl-sig-value ${(c.argument_identity?.mean_identity ?? 0) > 0.4 ? "alert" : ""}`}
        >
          {c.argument_identity?.mean_identity != null
            ? c.argument_identity.mean_identity.toFixed(2)
            : "—"}
        </div>
        <div className="dl-sig-sub">
          unanimity{" "}
          {c.argument_identity?.position_unanimity != null
            ? `${(c.argument_identity.position_unanimity * 100).toFixed(0)}%`
            : "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <RadialFill value={c.argument_identity?.mean_identity ?? 0} />
        </div>
      </div>

      {/* CAMPAIGN DNA */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">CAMPAIGN DNA</div>
        <div className="dl-sig-value">{c.classification === "campaign" ? "POSITIVE" : c.classification === "uncertain" ? "MIXED" : "ORGANIC"}</div>
        <div className="dl-sig-sub">6-axis fingerprint</div>
        <div style={{ marginTop: "auto", paddingTop: 2, display: "flex", justifyContent: "center" }}>
          <CampaignRadar c={c} />
        </div>
      </div>

      {/* GEOGRAPHIC */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">GEOGRAPHIC CONC</div>
        <div
          className={`dl-sig-value ${(c.geographic?.concentration_score ?? 0) > 0.5 ? "alert" : ""}`}
        >
          {c.geographic?.concentration_score != null
            ? c.geographic.concentration_score.toFixed(2)
            : "—"}
        </div>
        <div className="dl-sig-sub">
          {c.geographic?.top_state || "—"}{" "}
          {c.geographic?.top_state_pct
            ? `${(c.geographic.top_state_pct * 100).toFixed(0)}%`
            : ""}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <StateBars dist={c.geographic?.state_distribution || {}} />
        </div>
      </div>

      {/* ENTITIES */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">ENTITY MATCH</div>
        <div className={`dl-sig-value ${(c.entities?.match_rate ?? 0) > 0.3 ? "alert" : ""}`}>
          {c.entities?.match_rate != null
            ? `${(c.entities.match_rate * 100).toFixed(0)}%`
            : "—"}
        </div>
        <div className="dl-sig-sub">
          {c.entities?.top_entity ? c.entities.top_entity.slice(0, 22) : "—"}
        </div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <EntityBars stats={c.entities} />
        </div>
      </div>

      {/* MINI SANKEY */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">FLOW</div>
        <div className="dl-sig-value">{fmtMulti(c.n_comments)}</div>
        <div className="dl-sig-sub">→ verdict</div>
        <div style={{ marginTop: "auto", paddingTop: 2 }}>
          <MiniSankey c={c} />
        </div>
      </div>

      {/* SIGNAL PROFILE */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">SIGNAL PROFILE</div>
        <div className={`dl-sig-value ${c.campaign_score > 0.6 ? "alert" : ""}`}>
          {c.score_breakdown ? Object.values(c.score_breakdown).filter((v) => (v as number) > 0.5).length : 0}/6
        </div>
        <div className="dl-sig-sub">signals firing</div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <SignalDots c={c} />
        </div>
      </div>

      {/* CAMP SCORE */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">COMPOSITE SCORE</div>
        <div
          className={`dl-sig-value ${
            c.classification === "campaign"
              ? "alert"
              : c.classification === "uncertain"
              ? "warn"
              : "good"
          }`}
        >
          {c.campaign_score.toFixed(2)}
        </div>
        <div className="dl-sig-sub">{c.classification.toUpperCase()}</div>
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <BreakdownBars breakdown={breakdown} />
        </div>
      </div>

      {/* MEMBERS / SAMPLE COMMENT */}
      <div className="dl-sig-cell">
        <div className="dl-sig-label">CLUSTER #{c.cluster_id}</div>
        <div className="dl-sig-value">{fmtMulti(c.n_comments)}</div>
        <div className="dl-sig-sub">members</div>
        <div
          style={{
            marginTop: "auto",
            paddingTop: 4,
            color: "var(--fg-muted)",
            fontSize: 8,
            lineHeight: 1.3,
            maxHeight: 36,
            overflow: "hidden",
          }}
        >
          {(c.sample_comments[0] || "").slice(0, 110)}
        </div>
      </div>
    </div>
  );
}

function FeatureBars({ values, labels }: { values: number[]; labels: string[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 0.01);
  const W = 130;
  const H = 28;
  const bw = W / values.length;
  return (
    <svg className="dl-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {values.map((v, i) => {
        const h = (v / max) * H;
        return (
          <rect
            key={i}
            x={i * bw + 0.3}
            y={H - h}
            width={bw - 0.6}
            height={h}
            fill={v < 0.3 ? "#FF3B3B" : v < 0.6 ? "#FFB800" : "#00D26A"}
            opacity={0.85}
          >
            <title>{labels?.[i] || ""}: {v.toFixed(2)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function DuplicateGradient({ cluster }: { cluster: Cluster }) {
  const dc = cluster.duplicate_chain;
  if (!dc) return null;
  const total = dc.n_total || 1;
  const exact = (dc.n_exact_dup || 0) / total;
  const near = (dc.n_near_dup_members || 0) / total - exact;
  const para = 1 - exact - near;
  const W = 130;
  const H = 8;
  return (
    <div>
      <svg className="dl-svg" width={W} height={H}>
        <rect x={0} y={0} width={W * exact} height={H} fill="#FF3B3B" />
        <rect x={W * exact} y={0} width={W * Math.max(0, near)} height={H} fill="#FFB800" />
        <rect x={W * (exact + Math.max(0, near))} y={0} width={W * Math.max(0, para)} height={H} fill="#FFA028" />
      </svg>
      <div style={{ fontSize: 7, color: "var(--fg-muted)", marginTop: 2 }}>
        exact {(exact * 100).toFixed(0)}% · near {(Math.max(0, near) * 100).toFixed(0)}% · para {(Math.max(0, para) * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function DivergenceMeter({ value, label }: { value: number; label: string }) {
  const W = 130;
  const H = 8;
  const v = Math.min(1.5, value);
  const pos = (v / 1.5) * W;
  return (
    <div>
      <svg className="dl-svg" width={W} height={H}>
        <rect x={0} y={2} width={W} height={4} fill="#1F2937" />
        <rect
          x={Math.min(pos, W * 0.5)}
          y={2}
          width={Math.abs(W * 0.5 - pos) || 1}
          height={4}
          fill={pos < W * 0.4 ? "#FF3B3B" : pos < W * 0.7 ? "#FFB800" : "#00D26A"}
        />
        <line x1={W * 0.5} y1={0} x2={W * 0.5} y2={H} stroke="#FFFFFF" strokeWidth={0.5} />
      </svg>
      <div style={{ fontSize: 7, color: "var(--fg-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function RadialFill({ value }: { value: number }) {
  const W = 130;
  const H = 28;
  const r = 12;
  const cx = W / 2;
  const cy = H / 2 + 1;
  const angle = value * Math.PI * 2 - Math.PI / 2;
  const arcLen = Math.PI * 2 * r * value;
  return (
    <svg className="dl-svg" width={W} height={H}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1F2937" strokeWidth={3} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={value > 0.6 ? "#FF3B3B" : value > 0.3 ? "#FFB800" : "#00D26A"}
        strokeWidth={3}
        strokeDasharray={`${arcLen} ${Math.PI * 2 * r}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy + 2}
        textAnchor="middle"
        fontSize="7"
        fontFamily="IBM Plex Mono, monospace"
        fontWeight="700"
        fill="#FFA028"
      >
        {(value * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function CampaignRadar({ c }: { c: Cluster }) {
  const W = 86;
  const H = 56;
  const cx = W / 2;
  const cy = H / 2;
  const r = 13;
  const axes = [
    { label: "TMP", v: c.score_breakdown?.temporal_coupling || 0 },
    { label: "STY", v: c.score_breakdown?.stylometric || 0 },
    { label: "DUP", v: c.score_breakdown?.duplicate || 0 },
    { label: "AI", v: c.score_breakdown?.ai_detection || 0 },
    { label: "ARG", v: c.score_breakdown?.argument_identity || 0 },
    { label: "GEO", v: c.geographic?.concentration_score ?? 0 },
  ];
  const angle = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const point = (i: number, v: number) => [
    cx + Math.cos(angle(i)) * r * v,
    cy + Math.sin(angle(i)) * r * v,
  ];
  const dataPath =
    "M " +
    axes.map((a, i) => point(i, a.v).join(",")).join(" L ") +
    " Z";

  return (
    <svg className="dl-svg" width={W} height={H}>
      {[0.33, 0.66, 1].map((scale, i) => (
        <polygon
          key={i}
          points={axes.map((_, j) => point(j, scale).join(",")).join(" ")}
          fill="none"
          stroke="#1F2937"
          strokeWidth={0.5}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1F2937" strokeWidth={0.4} />
        );
      })}
      <path
        d={dataPath}
        fill={c.classification === "campaign" ? "#FF3B3B" : c.classification === "uncertain" ? "#FFB800" : "#00D26A"}
        fillOpacity={0.35}
        stroke={c.classification === "campaign" ? "#FF3B3B" : c.classification === "uncertain" ? "#FFB800" : "#00D26A"}
        strokeWidth={1}
      />
      {axes.map((a, i) => {
        const ang = angle(i);
        const [x, y] = point(i, 1.6);
        const dy = Math.sin(ang) > 0.4 ? 4 : Math.sin(ang) < -0.4 ? -1 : 2;
        return (
          <text
            key={i}
            x={x}
            y={y + dy}
            textAnchor="middle"
            fontSize="5.5"
            fontFamily="IBM Plex Mono, monospace"
            fontWeight="700"
            fill="#FFA028"
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

function MiniSankey({ c }: { c: Cluster }) {
  const W = 130;
  const H = 30;
  const verdict =
    c.classification === "campaign"
      ? "MFR"
      : c.classification === "uncertain"
      ? "UNC"
      : "ORG";
  const verdictColor =
    c.classification === "campaign"
      ? "#FF3B3B"
      : c.classification === "uncertain"
      ? "#FFB800"
      : "#00D26A";
  const sx0 = 4;
  const sx1 = W * 0.4;
  const sx2 = W - 30;
  const sy = H / 2;
  const w = 14;
  return (
    <svg className="dl-svg" width={W} height={H}>
      <rect x={sx0} y={2} width={3} height={H - 4} fill="#FFA028" opacity={0.9} />
      <rect x={sx1} y={2} width={3} height={H - 4} fill="#FFA028" />
      <rect x={sx2} y={2} width={3} height={H - 4} fill={verdictColor} />
      <path
        d={`M ${sx0 + 3},${sy - w / 2} C ${sx1 / 2},${sy - w / 2} ${sx1 / 2},${sy + w / 2} ${sx1},${sy + w / 2} L ${sx1},${sy - w / 2} Z`}
        fill="#FFA028"
        fillOpacity={0.3}
      />
      <path
        d={`M ${sx1 + 3},${sy - w / 2} C ${(sx1 + sx2) / 2},${sy - w / 2} ${(sx1 + sx2) / 2},${sy + w / 2} ${sx2},${sy + w / 2} L ${sx2},${sy - w / 2} Z`}
        fill={verdictColor}
        fillOpacity={0.3}
      />
      <text x={sx0 - 1} y={H - 2} fontSize="5" fontFamily="IBM Plex Mono, monospace" fill="#B8860B">
        ALL
      </text>
      <text x={sx1 + 5} y={H - 2} fontSize="5" fontFamily="IBM Plex Mono, monospace" fill="#FFA028">
        #{c.cluster_id}
      </text>
      <text x={sx2 + 5} y={H - 2} fontSize="5" fontFamily="IBM Plex Mono, monospace" fontWeight="700" fill={verdictColor}>
        {verdict}
      </text>
    </svg>
  );
}

function SignalDots({ c }: { c: Cluster }) {
  const signals = [
    { label: "TMP", v: c.score_breakdown?.temporal_coupling || 0 },
    { label: "STY", v: c.score_breakdown?.stylometric || 0 },
    { label: "DUP", v: c.score_breakdown?.duplicate || 0 },
    { label: "AI", v: c.score_breakdown?.ai_detection || 0 },
    { label: "ARG", v: c.score_breakdown?.argument_identity || 0 },
    { label: "GEO", v: c.geographic?.concentration_score ?? 0 },
  ];
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
      {signals.map((s) => (
        <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
          <div
            style={{
              width: "100%",
              height: 20,
              background: "#1F2937",
              position: "relative",
              border: "1px solid #2A3343",
            }}
          >
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: `${Math.min(100, s.v * 100)}%`,
                background:
                  s.v > 0.6 ? "#FF3B3B" : s.v > 0.4 ? "#FFB800" : "#FFA028",
              }}
            />
          </div>
          <div style={{ fontSize: 6, color: "#B8860B", marginTop: 1 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function SophisticationBar({ c }: { c: Cluster }) {
  const tiers = ["lazy_template", "near_duplicate", "ai_paraphrased", "organic"];
  const colors = ["#FF3B3B", "#FFB800", "#C792EA", "#00D26A"];
  const current = c.duplicate_chain?.sophistication || "organic";
  return (
    <div style={{ display: "flex", gap: 1 }}>
      {tiers.map((t, i) => (
        <div
          key={t}
          style={{
            flex: 1,
            height: 6,
            background: t === current ? colors[i] : "#1F2937",
            opacity: t === current ? 1 : 0.4,
          }}
          title={t}
        />
      ))}
    </div>
  );
}

function StateBars({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div>
      {entries.map(([state, count]) => (
        <div
          key={state}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 7,
            color: "var(--fg-muted)",
            lineHeight: 1.1,
          }}
        >
          <span style={{ width: 14, color: "var(--data-link)" }}>{state}</span>
          <div style={{ flex: 1, height: 4, background: "#1F2937" }}>
            <div
              style={{
                width: `${(count / total) * 100}%`,
                height: "100%",
                background: count / total > 0.5 ? "#FF3B3B" : "#FFA028",
              }}
            />
          </div>
          <span style={{ width: 22, textAlign: "right", color: "var(--fg-primary)" }}>
            {((count / total) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function EntityBars({ stats }: { stats: Cluster["entities"] }) {
  if (!stats?.sector_breakdown) return null;
  const entries = Object.entries(stats.sector_breakdown).slice(0, 4);
  const max = Math.max(...entries.map(([, v]) => v as number), 1);
  return (
    <div>
      {entries.map(([sector, count]) => (
        <div
          key={sector}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 7,
            color: "var(--fg-muted)",
            lineHeight: 1.2,
          }}
        >
          <span style={{ width: 38, color: "var(--data-link)" }}>{sector.slice(0, 6)}</span>
          <div style={{ flex: 1, height: 4, background: "#1F2937" }}>
            <div
              style={{
                width: `${((count as number) / max) * 100}%`,
                height: "100%",
                background: "#FFA028",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownBars({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown);
  return (
    <div>
      {entries.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 7,
            color: "var(--fg-muted)",
            lineHeight: 1.1,
          }}
        >
          <span style={{ width: 38 }}>{k.slice(0, 6)}</span>
          <div style={{ flex: 1, height: 4, background: "#1F2937" }}>
            <div
              style={{
                width: `${v * 100}%`,
                height: "100%",
                background: v > 0.6 ? "#FF3B3B" : v > 0.4 ? "#FFB800" : "#00D26A",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function GeoPanel({
  cluster,
  allClusters,
  selectedState,
  onSelectState,
}: {
  cluster: Cluster | null;
  allClusters: Cluster[];
  selectedState: string | null;
  onSelectState: (s: string) => void;
}) {
  const dist = cluster?.geographic?.state_distribution || {};
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  const aggDist = useMemo(() => {
    const agg: Record<string, number> = {};
    allClusters.forEach((c) => {
      const d = c.geographic?.state_distribution || {};
      Object.entries(d).forEach(([s, v]) => {
        agg[s] = (agg[s] || 0) + v;
      });
    });
    return agg;
  }, [allClusters]);

  const displayDist = entries.length > 0 ? dist : aggDist;
  const displayEntries = Object.entries(displayDist).sort((a, b) => b[1] - a[1]);
  const displayTotal = displayEntries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="dl-panel dl-geo">
      <div className="dl-panel-header">
        <span className="dl-panel-code">GEO</span>
        <span className="dl-panel-title">
          USA · GEOGRAPHIC CONCENTRATION
          {cluster ? ` · CLUS ${cluster.cluster_id}` : " · ALL CLUSTERS"}
        </span>
        <span className="dl-panel-meta">SCROLL TO ZOOM · DRAG TO PAN</span>
      </div>
      <div className="dl-panel-body flush" style={{ padding: 0 }}>
        <USMap
          distribution={displayDist}
          selectedState={selectedState}
          onSelectState={onSelectState}
        />
      </div>
    </div>
  );
}
