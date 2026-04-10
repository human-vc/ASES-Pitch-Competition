"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { geoPath, geoNaturalEarth1 } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";

interface Props {
  distribution: Record<string, number>; // ISO2 → count
  highlighted: string[]; // ISO2 codes flagged as alert
  selectedCountry?: string | null;
  onSelectCountry?: (iso2: string) => void;
}

// Numeric ISO 3166-1 (used in world-atlas) → ISO 3166-1 alpha-2
const NUMERIC_TO_ISO2: Record<string, string> = {
  "004": "AF", "008": "AL", "010": "AQ", "012": "DZ", "016": "AS", "020": "AD",
  "024": "AO", "028": "AG", "031": "AZ", "032": "AR", "036": "AU", "040": "AT",
  "044": "BS", "048": "BH", "050": "BD", "051": "AM", "052": "BB", "056": "BE",
  "060": "BM", "064": "BT", "068": "BO", "070": "BA", "072": "BW", "076": "BR",
  "084": "BZ", "086": "IO", "090": "SB", "092": "VG", "096": "BN", "100": "BG",
  "104": "MM", "108": "BI", "112": "BY", "116": "KH", "120": "CM", "124": "CA",
  "132": "CV", "136": "KY", "140": "CF", "144": "LK", "148": "TD", "152": "CL",
  "156": "CN", "158": "TW", "162": "CX", "166": "CC", "170": "CO", "174": "KM",
  "175": "YT", "178": "CG", "180": "CD", "184": "CK", "188": "CR", "191": "HR",
  "192": "CU", "196": "CY", "203": "CZ", "204": "BJ", "208": "DK", "212": "DM",
  "214": "DO", "218": "EC", "222": "SV", "226": "GQ", "231": "ET", "232": "ER",
  "233": "EE", "234": "FO", "238": "FK", "242": "FJ", "246": "FI", "248": "AX",
  "250": "FR", "254": "GF", "258": "PF", "260": "TF", "262": "DJ", "266": "GA",
  "268": "GE", "270": "GM", "275": "PS", "276": "DE", "288": "GH", "292": "GI",
  "296": "KI", "300": "GR", "304": "GL", "308": "GD", "312": "GP", "316": "GU",
  "320": "GT", "324": "GN", "328": "GY", "332": "HT", "334": "HM", "336": "VA",
  "340": "HN", "344": "HK", "348": "HU", "352": "IS", "356": "IN", "360": "ID",
  "364": "IR", "368": "IQ", "372": "IE", "376": "IL", "380": "IT", "384": "CI",
  "388": "JM", "392": "JP", "398": "KZ", "400": "JO", "404": "KE", "408": "KP",
  "410": "KR", "414": "KW", "417": "KG", "418": "LA", "422": "LB", "426": "LS",
  "428": "LV", "430": "LR", "434": "LY", "438": "LI", "440": "LT", "442": "LU",
  "446": "MO", "450": "MG", "454": "MW", "458": "MY", "462": "MV", "466": "ML",
  "470": "MT", "474": "MQ", "478": "MR", "480": "MU", "484": "MX", "492": "MC",
  "496": "MN", "498": "MD", "499": "ME", "500": "MS", "504": "MA", "508": "MZ",
  "512": "OM", "516": "NA", "520": "NR", "524": "NP", "528": "NL", "531": "CW",
  "533": "AW", "534": "SX", "535": "BQ", "540": "NC", "548": "VU", "554": "NZ",
  "558": "NI", "562": "NE", "566": "NG", "570": "NU", "574": "NF", "578": "NO",
  "580": "MP", "581": "UM", "583": "FM", "584": "MH", "585": "PW", "586": "PK",
  "591": "PA", "598": "PG", "600": "PY", "604": "PE", "608": "PH", "612": "PN",
  "616": "PL", "620": "PT", "624": "GW", "626": "TL", "630": "PR", "634": "QA",
  "638": "RE", "642": "RO", "643": "RU", "646": "RW", "652": "BL", "654": "SH",
  "659": "KN", "660": "AI", "662": "LC", "663": "MF", "666": "PM", "670": "VC",
  "674": "SM", "678": "ST", "682": "SA", "686": "SN", "688": "RS", "690": "SC",
  "694": "SL", "702": "SG", "703": "SK", "704": "VN", "705": "SI", "706": "SO",
  "710": "ZA", "716": "ZW", "724": "ES", "728": "SS", "729": "SD", "732": "EH",
  "740": "SR", "744": "SJ", "748": "SZ", "752": "SE", "756": "CH", "760": "SY",
  "762": "TJ", "764": "TH", "768": "TG", "772": "TK", "776": "TO", "780": "TT",
  "784": "AE", "788": "TN", "792": "TR", "795": "TM", "796": "TC", "798": "TV",
  "800": "UG", "804": "UA", "807": "MK", "818": "EG", "826": "GB", "831": "GG",
  "832": "JE", "833": "IM", "834": "TZ", "840": "US", "850": "VI", "854": "BF",
  "858": "UY", "860": "UZ", "862": "VE", "876": "WF", "882": "WS", "887": "YE",
  "894": "ZM",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountryFeature = Feature<Geometry, any>;

export default function WorldMap({
  distribution,
  highlighted,
  selectedCountry,
  onSelectCountry,
}: Props) {
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [hoverCountry, setHoverCountry] = useState<string | null>(null);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => r.json())
      .then((topo) => {
        const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
        setCountries(fc.features as CountryFeature[]);
      });
  }, []);

  const W = 760;
  const H = 360;

  const projection = useMemo(() => {
    return geoNaturalEarth1().fitSize([W - 8, H - 8], {
      type: "FeatureCollection",
      features: countries || [],
    } as FeatureCollection);
  }, [countries]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const max = Math.max(...Object.values(distribution), 1);
  const total = Object.values(distribution).reduce((s, v) => s + v, 0) || 1;

  const colorFor = (iso2: string, isHighlight: boolean) => {
    const v = distribution[iso2] || 0;
    if (isHighlight && v === 0) return "#7A1A1A";
    if (v === 0) return "#1A1F2E";
    const i = v / max;
    if (i > 0.5) return "#FF3B3B";
    if (i > 0.2) return "#FFB800";
    return "#FFA028";
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    const newZoom = Math.max(1, Math.min(6, zoom + delta * zoom));
    setZoom(newZoom);
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };
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

  const vbW = W / zoom;
  const vbH = H / zoom;
  const cx = W / 2 - pan.x / zoom;
  const cy = H / 2 - pan.y / zoom;
  const vbX = Math.max(0, Math.min(W - vbW, cx - vbW / 2));
  const vbY = Math.max(0, Math.min(H - vbH, cy - vbH / 2));

  if (!countries) {
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
        loading world map...
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        className="dl-svg"
        width="100%"
        height="100%"
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          setHoverCountry(null);
        }}
        style={{ cursor: zoom > 1 ? (draggingRef.current ? "grabbing" : "grab") : "default" }}
      >
        {countries.map((feat, fi) => {
          const iso2 = NUMERIC_TO_ISO2[String(feat.id ?? "").padStart(3, "0")] || "";
          const isHighlight = highlighted.includes(iso2);
          const isSelected = selectedCountry === iso2;
          const hasData = (distribution[iso2] || 0) > 0;
          const d = pathGen(feat);
          if (!d) return null;
          return (
            <path
              key={feat.id != null ? `c-${feat.id}` : `i-${fi}`}
              d={d}
              fill={colorFor(iso2, isHighlight)}
              stroke={isSelected ? "#FFFFFF" : "#FFFFFF"}
              strokeWidth={isSelected ? 1.6 : isHighlight ? 0.6 : 0.35}
              opacity={hasData || isHighlight ? 0.98 : 0.55}
              onMouseEnter={() => setHoverCountry(iso2)}
              onClick={() => {
                if (iso2 && onSelectCountry) onSelectCountry(iso2);
              }}
              style={{ cursor: iso2 && onSelectCountry ? "pointer" : "default" }}
            >
              <title>
                {iso2 || feat.properties?.name || ""}
                {hasData ? `: ${(distribution[iso2] * 8).toLocaleString()} comments (${(((distribution[iso2] || 0) / total) * 100).toFixed(1)}%)` : ""}
              </title>
            </path>
          );
        })}

        {/* Labels for countries with data */}
        {countries.map((feat, fi) => {
          const iso2 = NUMERIC_TO_ISO2[String(feat.id ?? "").padStart(3, "0")] || "";
          if (!distribution[iso2]) return null;
          const centroid = pathGen.centroid(feat);
          if (!centroid || isNaN(centroid[0])) return null;
          const fontSize = 7 / zoom;
          return (
            <g key={feat.id != null ? `lc-${feat.id}` : `li-${fi}`} style={{ pointerEvents: "none" }}>
              <text
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                fontSize={fontSize}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="700"
                fill="#FFFFFF"
                stroke="#000"
                strokeWidth={0.3}
                paintOrder="stroke"
              >
                {iso2}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Zoom controls */}
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
