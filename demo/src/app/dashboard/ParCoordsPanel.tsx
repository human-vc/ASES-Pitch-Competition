"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, DashboardData } from "./types";

interface Props {
  data: DashboardData;
  width: number;  // unused — kept for API compat
  height: number; // unused — kept for API compat
  selectedCluster: number | null;
  onSelect: (id: number) => void;
}

const AXES: { key: string; label: string; full: string; getter: (c: Cluster) => number }[] = [
  { key: "tcs", label: "TEMPORAL", full: "Temporal coupling — synchronized submission bursts", getter: (c) => c.temporal?.tcs ?? 0 },
  { key: "burst", label: "Λ*", full: "Kulldorff scan statistic — burst significance", getter: (c) => Math.min(1, (c.temporal?.lambda_star ?? 0) / 200) },
  { key: "style", label: "STYLO", full: "Stylometric uniformity — readability variance collapse", getter: (c) => c.stylometric?.campaign_score ?? 0 },
  { key: "boxm", label: "BOX M", full: "Box's M test — multivariate covariance homogeneity", getter: (c) => Math.min(1, (c.stylometric?.chi_stat ?? 0) / 10000) },
  { key: "dup", label: "DUP", full: "Near-duplicate fraction — MinHash LSH overlap", getter: (c) => c.duplicates?.dup_fraction ?? 0 },
  { key: "sim", label: "SIM", full: "Mean pairwise similarity — semantic distance collapse", getter: (c) => c.duplicate_chain?.mean_pairwise_similarity ?? 0 },
  { key: "ai", label: "AI", full: "AI generation likelihood — DivEye surprisal", getter: (c) => c.ai_detection?.ai_score ?? 0 },
  { key: "arg", label: "ARG ID", full: "Argument identity — shared premise structure", getter: (c) => c.argument_identity?.mean_identity ?? 0 },
  { key: "unan", label: "UNAN", full: "Position unanimity — stance agreement", getter: (c) => c.argument_identity?.position_unanimity ?? 0 },
  { key: "geo", label: "GEO", full: "Geographic concentration — KL divergence from baseline", getter: (c) => c.geographic?.concentration_score ?? 0 },
  { key: "ent", label: "ENT", full: "Entity match rate — known lobbying registry hits", getter: (c) => c.entities?.match_rate ?? 0 },
  { key: "score", label: "SCORE", full: "Composite campaign score — weighted signal sum", getter: (c) => c.campaign_score },
];

type Brush = { min: number; max: number }; // 0..1, inverted (0 = bottom, 1 = top)

export default function ParCoordsPanel({
  data,
  selectedCluster,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 840, height: 244 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          setSize({ width: Math.round(w), height: Math.round(h) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = size.width;
  const height = size.height;

  const [brushes, setBrushes] = useState<Record<number, Brush>>({});
  const [dragState, setDragState] = useState<{
    axisIdx: number;
    startY: number;
    strip: "campaign" | "organic";
  } | null>(null);
  const [hoverCluster, setHoverCluster] = useState<number | null>(null);
  const [hoverAxis, setHoverAxis] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const padAxisTop = 12;
  const padStripHeader = 2;
  const padLeft = 44;
  const padRight = 64;
  const stripGap = 6;
  const padHintBottom = 14;
  const innerW = width - padLeft - padRight;
  const stripH =
    (height - padAxisTop - padStripHeader - stripGap - padStripHeader - padHintBottom) / 2;
  const campStripTop = padAxisTop + padStripHeader;
  const orgStripTop = campStripTop + stripH + stripGap;
  const axisX = (i: number) => padLeft + (i / (AXES.length - 1)) * innerW;
  const valY = (v: number, stripTop: number) => stripTop + (1 - v) * stripH;

  const { campaignClusters, organicClusters } = useMemo(() => {
    const camp: Cluster[] = [];
    const org: Cluster[] = [];
    data.clusters.forEach((c) => {
      if (c.classification === "campaign") camp.push(c);
      else org.push(c);
    });
    return { campaignClusters: camp, organicClusters: org };
  }, [data]);

  const computeMedian = (clusters: Cluster[]) =>
    AXES.map((a) => {
      if (clusters.length === 0) return 0;
      const vals = clusters.map((c) => a.getter(c)).sort((x, y) => x - y);
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
    });
  const campMedian = useMemo(() => computeMedian(campaignClusters), [campaignClusters]);
  const orgMedian = useMemo(() => computeMedian(organicClusters), [organicClusters]);

  const passesBrushes = (cluster: Cluster): boolean => {
    for (const [idxStr, br] of Object.entries(brushes)) {
      const idx = parseInt(idxStr);
      const v = AXES[idx].getter(cluster);
      if (v < br.min || v > br.max) return false;
    }
    return true;
  };

  const activeBrushCount = Object.keys(brushes).length;

  const campaignMatches = campaignClusters.filter(passesBrushes).length;
  const organicMatches = organicClusters.filter(passesBrushes).length;

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * width;
    const my = ((e.clientY - rect.top) / rect.height) * height;

    let nearestAxis = 0;
    let minDist = Infinity;
    AXES.forEach((_, i) => {
      const d = Math.abs(axisX(i) - mx);
      if (d < minDist) {
        minDist = d;
        nearestAxis = i;
      }
    });
    if (minDist > 24) return;

    let strip: "campaign" | "organic";
    if (my >= campStripTop && my <= campStripTop + stripH) {
      strip = "campaign";
    } else if (my >= orgStripTop && my <= orgStripTop + stripH) {
      strip = "organic";
    } else {
      return;
    }

    setDragState({ axisIdx: nearestAxis, startY: my, strip });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const my = ((e.clientY - rect.top) / rect.height) * height;

    const stripTop = dragState.strip === "campaign" ? campStripTop : orgStripTop;
    const y0 = Math.max(stripTop, Math.min(dragState.startY, my));
    const y1 = Math.min(stripTop + stripH, Math.max(dragState.startY, my));

    const max = 1 - (y0 - stripTop) / stripH;
    const min = 1 - (y1 - stripTop) / stripH;

    if (Math.abs(y1 - y0) < 4) return;

    setBrushes((prev) => ({ ...prev, [dragState.axisIdx]: { min, max } }));
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  const clearBrush = (axisIdx: number) => {
    setBrushes((prev) => {
      const next = { ...prev };
      delete next[axisIdx];
      return next;
    });
  };

  const clearAllBrushes = () => setBrushes({});

  const renderStrip = (
    clusters: Cluster[],
    stripTop: number,
    label: string,
    color: string,
    alertColor: string,
    medianProfile: number[],
    medianGradientId: string
  ) => {
    const matchCount = clusters.filter(passesBrushes).length;
    const medianPts = medianProfile
      .map((v, i) => `${axisX(i)},${valY(v, stripTop)}`)
      .join(" ");

    return (
      <g>
        <rect
          x={padLeft}
          y={stripTop}
          width={innerW}
          height={stripH}
          fill="#050505"
          stroke="#1A1108"
          strokeWidth={0.5}
        />

        <rect
          x={padLeft}
          y={valY(1, stripTop)}
          width={innerW}
          height={valY(0.5, stripTop) - valY(1, stripTop)}
          fill={color}
          fillOpacity={0.05}
        />
        <line
          x1={padLeft}
          y1={valY(0.5, stripTop)}
          x2={width - padRight}
          y2={valY(0.5, stripTop)}
          stroke={color}
          strokeWidth={0.4}
          strokeDasharray="2,2"
          opacity={0.5}
        />
        <text
          x={width - padRight - 2}
          y={valY(0.5, stripTop) - 1}
          textAnchor="end"
          fontSize="5"
          fontFamily="IBM Plex Mono, monospace"
          fill={color}
          opacity={0.7}
        >
          THRESHOLD 0.5
        </text>

        {[0.25, 0.75].map((v, i) => (
          <line
            key={`g-${stripTop}-${i}`}
            x1={padLeft}
            y1={valY(v, stripTop)}
            x2={width - padRight}
            y2={valY(v, stripTop)}
            stroke="#181410"
            strokeWidth={0.3}
          />
        ))}

        {AXES.map((a, i) => {
          const isHoverAxis = hoverAxis === i;
          return (
            <line
              key={i}
              x1={axisX(i)}
              y1={stripTop}
              x2={axisX(i)}
              y2={stripTop + stripH}
              stroke={isHoverAxis ? "#FFA028" : "#2C2418"}
              strokeWidth={isHoverAxis ? 0.8 : 0.5}
              opacity={isHoverAxis ? 0.9 : 1}
            />
          );
        })}

        <text
          x={padLeft + 4}
          y={stripTop + 8}
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fontWeight="700"
          fill={color}
          letterSpacing="0.08em"
        >
          ▸ {label}
        </text>
        <text
          x={width - padRight - 2}
          y={stripTop + 8}
          textAnchor="end"
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fontWeight="600"
          fill="#B8860B"
        >
          {matchCount} / {clusters.length}
        </text>

        {[...clusters]
          .sort((a, b) => {
            const ap = passesBrushes(a) ? 1 : 0;
            const bp = passesBrushes(b) ? 1 : 0;
            if (ap !== bp) return ap - bp;
            return a.campaign_score - b.campaign_score;
          })
          .map((c) => {
            const pass = passesBrushes(c);
            const isSel = c.cluster_id === selectedCluster;
            const isHov = hoverCluster === c.cluster_id;
            const pts = AXES.map((a, i) =>
              `${axisX(i)},${valY(a.getter(c), stripTop)}`
            ).join(" ");
            const strokeColor = isSel
              ? "#FFFFFF"
              : !pass
              ? "#2A2218"
              : c.campaign_score > 0.7
              ? alertColor
              : color;
            const opacity = isSel
              ? 1
              : isHov
              ? 1
              : pass
              ? activeBrushCount > 0
                ? 0.85
                : 0.4
              : 0.1;
            return (
              <polyline
                key={c.cluster_id}
                points={pts}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isSel || isHov ? 1.8 : pass ? 0.7 : 0.35}
                strokeOpacity={opacity}
                onClick={() => onSelect(c.cluster_id)}
                onMouseEnter={() => setHoverCluster(c.cluster_id)}
                onMouseLeave={() => setHoverCluster(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

        <polyline
          points={medianPts}
          fill="none"
          stroke={`url(#${medianGradientId})`}
          strokeWidth={2.8}
          strokeOpacity={0.95}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
        {medianProfile.map((v, i) => (
          <circle
            key={`md-${i}`}
            cx={axisX(i)}
            cy={valY(v, stripTop)}
            r={1.6}
            fill={color}
            stroke="#000"
            strokeWidth={0.4}
            style={{ pointerEvents: "none" }}
          />
        ))}

        {Object.entries(brushes).map(([idxStr, br]) => {
          const idx = parseInt(idxStr);
          const x = axisX(idx) - 8;
          const y = valY(br.max, stripTop);
          const h = valY(br.min, stripTop) - y;
          return (
            <g key={`brush-${idxStr}-${stripTop}`}>
              <rect
                x={x}
                y={y}
                width={16}
                height={h}
                fill="#FFA028"
                fillOpacity={0.22}
                stroke="#FFA028"
                strokeWidth={0.8}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  clearBrush(idx);
                }}
              />
            </g>
          );
        })}
      </g>
    );
  };

  const hoveredCluster = hoverCluster != null
    ? data.clusters.find((c) => c.cluster_id === hoverCluster)
    : null;

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="dl-svg"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp();
        setHoverCluster(null);
        setHoverAxis(null);
      }}
      style={{ userSelect: "none", display: "block" }}
    >
      <defs>
        <linearGradient id="dl-pc-median-camp" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FF6464" />
          <stop offset="100%" stopColor="#FF1A1A" />
        </linearGradient>
        <linearGradient id="dl-pc-median-org" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#00D26A" />
          <stop offset="100%" stopColor="#FFB800" />
        </linearGradient>
      </defs>

      {AXES.map((a, i) => {
        const isHov = hoverAxis === i;
        const isBrushed = !!brushes[i];
        return (
          <g
            key={a.key}
            onMouseEnter={() => setHoverAxis(i)}
            onMouseLeave={() => setHoverAxis(null)}
            style={{ cursor: "default" }}
          >
            <rect
              x={axisX(i) - 18}
              y={0}
              width={36}
              height={padAxisTop}
              fill="transparent"
            />
            <text
              x={axisX(i)}
              y={padAxisTop - 2}
              textAnchor="middle"
              fontSize="8"
              fontFamily="IBM Plex Mono, monospace"
              fontWeight="700"
              fill={isBrushed ? "#FFA028" : isHov ? "#FFFFFF" : "#B8860B"}
            >
              {a.label}
              <title>{a.full}</title>
            </text>
          </g>
        );
      })}

      {activeBrushCount > 0 && (
        <g
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            clearAllBrushes();
          }}
        >
          <rect
            x={width - padRight + 8}
            y={padAxisTop - 9}
            width={52}
            height={11}
            fill="#FF3B3B"
            fillOpacity={0.15}
            stroke="#FF3B3B"
            strokeWidth={0.5}
          />
          <text
            x={width - padRight + 34}
            y={padAxisTop - 1}
            textAnchor="middle"
            fontSize="7"
            fontFamily="IBM Plex Mono, monospace"
            fontWeight="700"
            fill="#FF3B3B"
          >
            CLEAR {activeBrushCount}
          </text>
        </g>
      )}

      {renderStrip(
        campaignClusters,
        campStripTop,
        "MANUFACTURED",
        "#FF3B3B",
        "#FF1A1A",
        campMedian,
        "dl-pc-median-camp"
      )}

      {renderStrip(
        organicClusters,
        orgStripTop,
        "ORGANIC / UNCERTAIN",
        "#00D26A",
        "#FFB800",
        orgMedian,
        "dl-pc-median-org"
      )}

      <text x={padLeft - 4} y={campStripTop + 3} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">1.0</text>
      <text x={padLeft - 4} y={campStripTop + stripH / 2 + 2} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">0.5</text>
      <text x={padLeft - 4} y={campStripTop + stripH} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">0.0</text>
      <text x={padLeft - 4} y={orgStripTop + 3} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">1.0</text>
      <text x={padLeft - 4} y={orgStripTop + stripH / 2 + 2} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">0.5</text>
      <text x={padLeft - 4} y={orgStripTop + stripH} textAnchor="end" fontSize="6" fontFamily="IBM Plex Mono, monospace" fill="#6B5D3F">0.0</text>


      {hoveredCluster && (
        <text
          x={padLeft + 4}
          y={height - 2}
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fill="#FFFFFF"
        >
          <tspan fill="#FFA028" fontWeight="700">CLUS {hoveredCluster.cluster_id}</tspan>
          <tspan fill="#6B5D3F"> · </tspan>
          <tspan
            fill={
              hoveredCluster.classification === "campaign"
                ? "#FF3B3B"
                : hoveredCluster.classification === "uncertain"
                ? "#FFB800"
                : "#00D26A"
            }
            fontWeight="700"
          >
            {hoveredCluster.classification.toUpperCase()}
          </tspan>
          <tspan fill="#6B5D3F"> · </tspan>
          <tspan fill="#FFA028">SCORE {hoveredCluster.campaign_score.toFixed(2)}</tspan>
          <tspan fill="#6B5D3F"> · </tspan>
          <tspan fill="#00B4D8">CLICK TO SELECT</tspan>
        </text>
      )}
      {!hoveredCluster && hoverAxis != null && (
        <text
          x={padLeft + 4}
          y={height - 2}
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fill="#FFA028"
        >
          <tspan fontWeight="700">{AXES[hoverAxis].label}</tspan>
          <tspan fill="#6B5D3F"> — </tspan>
          <tspan fill="#FFFFFF">{AXES[hoverAxis].full}</tspan>
        </text>
      )}
      {!hoveredCluster && hoverAxis == null && activeBrushCount === 0 && campaignClusters.length > 0 && (
        <text
          x={padLeft + 4}
          y={height - 2}
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fill="#6B5D3F"
        >
          THICK LINE = MEDIAN FINGERPRINT · HOVER A LINE OR AXIS · DRAG ANY AXIS TO BRUSH-FILTER
        </text>
      )}
      {!hoveredCluster && hoverAxis == null && activeBrushCount > 0 && (
        <text
          x={padLeft + 4}
          y={height - 2}
          fontSize="7"
          fontFamily="IBM Plex Mono, monospace"
          fill="#FFA028"
        >
          {activeBrushCount} BRUSH{activeBrushCount > 1 ? "ES" : ""} ACTIVE · {campaignMatches} CAMP + {organicMatches} ORG MATCH · CLICK A BRUSH TO CLEAR
        </text>
      )}
    </svg>
    </div>
  );
}
