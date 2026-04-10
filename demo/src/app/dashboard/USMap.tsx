"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { geoPath, geoAlbersUsa } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";

interface Props {
  distribution: Record<string, number>;
  selectedState: string | null;
  onSelectState: (s: string) => void;
}

const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY",
};

const NOTABLE_COUNTIES: Record<string, string[]> = {
  TX: ["48201", "48029", "48113", "48439", "48453"],
  CA: ["06037", "06073", "06059", "06065", "06085"],
  FL: ["12086", "12011", "12095", "12057", "12099"],
  NY: ["36061", "36047", "36081", "36005", "36085"],
  IL: ["17031", "17043", "17089", "17097", "17197"],
  PA: ["42101", "42003", "42091", "42029", "42017"],
  OH: ["39035", "39061", "39049", "39153", "39093"],
  GA: ["13089", "13121", "13135", "13067", "13063"],
  NC: ["37119", "37183", "37081", "37067", "37063"],
  MI: ["26163", "26125", "26099", "26161", "26049"],
  VA: ["51059", "51153", "51087", "51810", "51760"],
  WA: ["53033", "53053", "53061", "53063", "53077"],
  MA: ["25025", "25017", "25005", "25021", "25027"],
  AZ: ["04013", "04019", "04015", "04021", "04025"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StateFeature = Feature<Geometry, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountyFeature = Feature<Geometry, any>;

export default function USMap({ distribution, selectedState, onSelectState }: Props) {
  const [states, setStates] = useState<StateFeature[] | null>(null);
  const [counties, setCounties] = useState<CountyFeature[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch("/us-states.json")
      .then((r) => r.json())
      .then((topo) => {
        const fc = feature(topo, topo.objects.states) as unknown as FeatureCollection;
        setStates(fc.features as StateFeature[]);
      });
    fetch("/us-counties.json")
      .then((r) => r.json())
      .then((topo) => {
        const fc = feature(topo, topo.objects.counties) as unknown as FeatureCollection;
        setCounties(fc.features as CountyFeature[]);
      });
  }, []);

  // Base viewport (large enough that the map fills nicely)
  const W = 760;
  const H = 360;

  const projection = useMemo(() => {
    return geoAlbersUsa().fitSize([W - 8, H - 8], {
      type: "FeatureCollection",
      features: states || [],
    } as FeatureCollection);
  }, [states]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const total = Object.values(distribution).reduce((s, v) => s + v, 0) || 1;
  const max = Math.max(...Object.values(distribution), 1);

  const colorFor = (state: string) => {
    const v = distribution[state] || 0;
    if (v === 0) return "#1A1F2E";
    const i = v / max;
    if (i > 0.6) return "#FF3B3B";
    if (i > 0.3) return "#FFB800";
    return "#FFA028";
  };

  const notableCountyIds = useMemo(() => {
    if (!selectedState) return new Set<string>();
    return new Set(NOTABLE_COUNTIES[selectedState] || []);
  }, [selectedState]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    const newZoom = Math.max(1, Math.min(6, zoom + delta * zoom));
    setZoom(newZoom);
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };

  // Drag pan
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (zoom === 1) return;
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  };
  const handleMouseUp = () => {
    draggingRef.current = false;
  };

  // Compute viewBox transform
  const vbW = W / zoom;
  const vbH = H / zoom;
  const cx = W / 2 - pan.x / zoom;
  const cy = H / 2 - pan.y / zoom;
  const vbX = Math.max(0, Math.min(W - vbW, cx - vbW / 2));
  const vbY = Math.max(0, Math.min(H - vbH, cy - vbH / 2));

  if (!states) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          color: "#FFA028",
          fontSize: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        loading map...
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={svgRef}
        className="dl-svg"
        width="100%"
        height="100%"
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (draggingRef.current ? "grabbing" : "grab") : "default" }}
      >
        {/* Base state shapes */}
        {states.map((feat, fi) => {
          if (feat.id == null) return null;
          const fips = String(feat.id).padStart(2, "0");
          const stateCode = FIPS_TO_STATE[fips];
          if (!stateCode) return null;
          const isSel = selectedState === stateCode;
          const isHighlight = (distribution[stateCode] || 0) > 0;
          const d = pathGen(feat);
          if (!d) return null;
          return (
            <path
              key={fips}
              d={d}
              fill={colorFor(stateCode)}
              stroke="#FFFFFF"
              strokeWidth={isSel ? 1.6 : 0.5}
              opacity={isHighlight ? 1 : 0.55}
              onClick={() => onSelectState(stateCode)}
              style={{ cursor: "pointer" }}
            >
              <title>
                {stateCode}: {(distribution[stateCode] || 0) * 8} comments ({(((distribution[stateCode] || 0) / total) * 100).toFixed(1)}%)
              </title>
            </path>
          );
        })}

        {/* Highlight notable counties when state is selected */}
        {selectedState && counties &&
          counties
            .filter((c) => c.id != null && notableCountyIds.has(String(c.id).padStart(5, "0")))
            .map((county, ci) => {
              const d = pathGen(county);
              if (!d) return null;
              return (
                <path
                  key={`co-${county.id ?? ci}`}
                  d={d}
                  fill="#FFFFFF"
                  stroke="#FFFFFF"
                  strokeWidth={0.8}
                  opacity={0.9}
                >
                  <title>{county.properties?.name || ""}</title>
                </path>
              );
            })}

        {/* All state labels */}
        {states.map((feat, fi) => {
          if (feat.id == null) return null;
          const fips = String(feat.id).padStart(2, "0");
          const stateCode = FIPS_TO_STATE[fips];
          if (!stateCode) return null;
          const centroid = pathGen.centroid(feat);
          if (!centroid || isNaN(centroid[0])) return null;
          const hasData = (distribution[stateCode] || 0) > 0;
          const intensity = hasData ? (distribution[stateCode] || 0) / max : 0;
          const pct = hasData ? ((distribution[stateCode] / total) * 100).toFixed(0) : null;
          const labelColor = hasData && intensity > 0.3 ? "#000000" : "#FFFFFF";
          const fontSize = 10 / zoom;
          return (
            <g key={`label-${fips}`} style={{ pointerEvents: "none" }}>
              <text
                x={centroid[0]}
                y={centroid[1] + (hasData ? 0 : fontSize * 0.3)}
                textAnchor="middle"
                fontSize={fontSize}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="700"
                fill={labelColor}
                opacity={hasData ? 1 : 0.85}
              >
                {stateCode}
              </text>
              {pct && (
                <text
                  x={centroid[0]}
                  y={centroid[1] + fontSize}
                  textAnchor="middle"
                  fontSize={fontSize * 0.78}
                  fontFamily="IBM Plex Mono, monospace"
                  fontWeight="600"
                  fill={labelColor}
                >
                  {pct}%
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Zoom controls overlay */}
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          zIndex: 5,
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(6, z * 1.4))}
          style={{
            background: "rgba(10,14,23,0.85)",
            border: "1px solid #2A3343",
            color: "#FFA028",
            cursor: "pointer",
            width: 22,
            height: 22,
            fontSize: 13,
            fontFamily: "monospace",
            padding: 0,
          }}
        >
          +
        </button>
        <button
          onClick={() => {
            const newZ = Math.max(1, zoom / 1.4);
            setZoom(newZ);
            if (newZ === 1) setPan({ x: 0, y: 0 });
          }}
          style={{
            background: "rgba(10,14,23,0.85)",
            border: "1px solid #2A3343",
            color: "#FFA028",
            cursor: "pointer",
            width: 22,
            height: 22,
            fontSize: 13,
            fontFamily: "monospace",
            padding: 0,
          }}
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          style={{
            background: "rgba(10,14,23,0.85)",
            border: "1px solid #2A3343",
            color: "#FFA028",
            cursor: "pointer",
            width: 22,
            height: 22,
            fontSize: 9,
            fontFamily: "monospace",
            padding: 0,
          }}
        >
          ⟲
        </button>
      </div>

      {/* Zoom level indicator */}
      {zoom > 1 && (
        <div
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            background: "rgba(10,14,23,0.85)",
            border: "1px solid #2A3343",
            color: "#FFA028",
            fontSize: 9,
            fontFamily: "monospace",
            padding: "1px 5px",
          }}
        >
          {zoom.toFixed(1)}×
        </div>
      )}
    </div>
  );
}
