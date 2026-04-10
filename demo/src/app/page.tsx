"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [docketId, setDocketId] = useState("FCC-2017-0200");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = () => {
    setLoading(true);
    setTimeout(() => router.push("/dashboard"), 1200);
  };

  return (
    <div
      style={{
        background: "#000",
        color: "#fff",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'SF Mono', 'IBM Plex Mono', 'Fira Code', monospace",
      }}
    >
      <div style={{ width: 380, textAlign: "center" }}>
        {/* Logo */}
        <svg
          width="48"
          height="38"
          viewBox="0 0 18 14"
          style={{ margin: "0 auto 16px", display: "block" }}
        >
          <path
            d="M1 1 L9 12 L17 1"
            fill="none"
            stroke="#FFA028"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="7" r="2" fill="#FFA028" />
          <circle
            cx="9"
            cy="7"
            r="3.5"
            fill="none"
            stroke="#FFA028"
            strokeWidth="0.6"
            opacity="0.5"
          />
        </svg>

        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.2em",
            color: "rgba(255,255,255,0.85)",
            marginBottom: 4,
          }}
        >
          VIGIL
        </div>
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            letterSpacing: "0.1em",
            marginBottom: 40,
          }}
        >
          REGULATORY COMMENT INTELLIGENCE
        </div>

        {/* Docket input */}
        <div style={{ textAlign: "left", marginBottom: 20 }}>
          <label
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.12em",
              display: "block",
              marginBottom: 6,
            }}
          >
            DOCKET ID
          </label>
          <input
            type="text"
            value={docketId}
            onChange={(e) => setDocketId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#FFA028",
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 600,
              padding: "10px 12px",
              letterSpacing: "0.04em",
              outline: "none",
              caretColor: "#FFA028",
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.2)",
              marginTop: 6,
              letterSpacing: "0.04em",
            }}
          >
            Restoring Internet Freedom &middot; 22M comments &middot; 60-day period
          </div>
        </div>

        {/* API status */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 24,
            fontSize: 9,
            color: "rgba(255,255,255,0.35)",
            letterSpacing: "0.06em",
          }}
        >
          <span>
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#22c55e",
                marginRight: 5,
                verticalAlign: "middle",
              }}
            />
            regulations.gov API
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#22c55e",
                marginRight: 5,
                verticalAlign: "middle",
              }}
            />
            ML pipeline
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#22c55e",
                marginRight: 5,
                verticalAlign: "middle",
              }}
            />
            Voyage AI
          </span>
        </div>

        {/* Analyze button */}
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            width: "100%",
            background: loading ? "rgba(255,160,40,0.15)" : "#FFA028",
            color: loading ? "#FFA028" : "#000",
            border: "none",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.15em",
            padding: "12px 0",
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {loading ? "CONNECTING..." : "ANALYZE"}
        </button>

        {/* Footer */}
        <div
          style={{
            marginTop: 32,
            fontSize: 8,
            color: "rgba(255,255,255,0.12)",
            letterSpacing: "0.06em",
          }}
        >
          VIGIL v0.1 &middot; JCRAINIC &middot; ASES 2026
        </div>
      </div>
    </div>
  );
}
