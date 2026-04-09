"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import gsap from "gsap";
import { getRandomComment } from "./comments";

// ─── Types ───────────────────────────────────────────────────────────
type Phase =
  | "waiting"      // Black void
  | "streaming"    // Comments rain down
  | "contaminating"// Red bleeds through
  | "chaos"        // Full red/white chaos
  | "clustering"   // Comments fly into clusters
  | "analyzed";    // Final dashboard state

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  text: string;
  fake: boolean;
  alpha: number;
  targetAlpha: number;
  color: string;
  targetColor: string;
  fontSize: number;
  // Cluster assignment for force simulation
  cluster: number;
  clusterX: number;
  clusterY: number;
  settled: boolean;
}

// ─── Cluster Definitions ─────────────────────────────────────────────
const CLUSTERS = [
  { label: "Campaign A: Industry Template", count: "8,534,201", color: "#ef4444", x: 0.25, y: 0.35, radius: 140 },
  { label: "Campaign B: Lead-Gen Firm #1", count: "4,211,087", color: "#f97316", x: 0.72, y: 0.30, radius: 120 },
  { label: "Campaign C: Bot Network", count: "3,892,445", color: "#ec4899", x: 0.30, y: 0.70, radius: 110 },
  { label: "Campaign D: Student Script", count: "1,562,267", color: "#a855f7", x: 0.68, y: 0.72, radius: 100 },
  // Green organic clusters
  { label: "Pro-Neutrality (Organic)", count: "2,841,000", color: "#22c55e", x: 0.50, y: 0.50, radius: 80 },
  { label: "Anti-Regulation (Organic)", count: "312,000", color: "#10b981", x: 0.88, y: 0.50, radius: 45 },
  { label: "Technical/Legal", count: "147,000", color: "#06b6d4", x: 0.12, y: 0.50, radius: 35 },
];

// ─── Stats for sidebar ───────────────────────────────────────────────
const STATS = {
  total: "22,000,000",
  campaigns: 4,
  fake: "18,200,000",
  fakePercent: "82.7%",
  unique: "3,300,000",
  uniquePercent: "15.0%",
  processingTime: "11.2s",
};

// ─── Constants ───────────────────────────────────────────────────────
const PARTICLE_COUNT = 600;
const SIDEBAR_WIDTH = 380;

export default function DemoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const phaseRef = useRef<Phase>("waiting");
  const animFrameRef = useRef<number>(0);
  const counterRef = useRef({ value: 0 });
  const sidebarOpacity = useRef({ value: 0 });
  const clusterLabelOpacity = useRef({ value: 0 });
  const glowIntensity = useRef({ value: 0 });
  const [phase, setPhase] = useState<Phase>("waiting");
  const [showHint, setShowHint] = useState(true);
  const dimensionsRef = useRef({ w: 0, h: 0 });

  // ─── Initialize particles ───────────────────────────────────────────
  const initParticles = useCallback((w: number, h: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const fake = Math.random() < 0.82; // 82% fake like the real data
      const cluster = fake
        ? Math.floor(Math.random() * 4) // campaigns 0-3
        : 4 + Math.floor(Math.random() * 3); // organic 4-6
      const def = CLUSTERS[cluster];
      particles.push({
        x: Math.random() * w,
        y: -50 - Math.random() * h * 3, // Start above screen
        vx: (Math.random() - 0.5) * 0.3,
        vy: 1.2 + Math.random() * 2.5,
        text: getRandomComment(fake),
        fake,
        alpha: 0,
        targetAlpha: 0.7 + Math.random() * 0.3,
        color: "rgba(200, 200, 200,",
        targetColor: fake ? def.color : "#22c55e",
        fontSize: 10 + Math.random() * 3,
        cluster,
        clusterX: def.x * (w - SIDEBAR_WIDTH) + (Math.random() - 0.5) * def.radius,
        clusterY: def.y * h + (Math.random() - 0.5) * def.radius,
        settled: false,
      });
    }
    particlesRef.current = particles;
  }, []);

  // ─── Phase transitions ─────────────────────────────────────────────
  const advancePhase = useCallback(() => {
    const current = phaseRef.current;
    const particles = particlesRef.current;
    const { w, h } = dimensionsRef.current;

    if (current === "waiting") {
      phaseRef.current = "streaming";
      setPhase("streaming");
      setShowHint(false);
      // Start counter animation
      gsap.to(counterRef.current, {
        value: 22000000,
        duration: 12,
        ease: "power2.in",
      });
    } else if (current === "streaming") {
      phaseRef.current = "contaminating";
      setPhase("contaminating");
      // Stagger the red reveal
      particles.forEach((p, i) => {
        if (p.fake) {
          const delay = Math.random() * 2.5;
          setTimeout(() => {
            p.targetColor = CLUSTERS[p.cluster].color;
          }, delay * 1000);
        }
      });
      // After contamination completes, move to chaos
      setTimeout(() => {
        phaseRef.current = "chaos";
        setPhase("chaos");
      }, 3000);
    } else if (current === "chaos" || current === "contaminating") {
      phaseRef.current = "clustering";
      setPhase("clustering");
      // Freeze particles then animate to cluster positions
      particles.forEach((p) => {
        p.vy = 0;
        p.vx = 0;
      });
      // Animate glow
      gsap.to(glowIntensity.current, { value: 1, duration: 1.5, ease: "power2.out" });
      // Stagger particles flying to clusters
      particles.forEach((p, i) => {
        const delay = Math.random() * 1.8;
        const def = CLUSTERS[p.cluster];
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * def.radius;
        const tx = def.x * (w - SIDEBAR_WIDTH) + Math.cos(angle) * dist;
        const ty = def.y * h + Math.sin(angle) * dist;
        p.clusterX = tx;
        p.clusterY = ty;
        gsap.to(p, {
          x: tx,
          y: ty,
          duration: 1.5 + Math.random() * 0.8,
          delay,
          ease: "power3.out",
          onComplete: () => { p.settled = true; },
        });
      });
      // Show sidebar after clustering starts
      setTimeout(() => {
        gsap.to(sidebarOpacity.current, { value: 1, duration: 0.8, ease: "power2.out" });
        gsap.to(clusterLabelOpacity.current, { value: 1, duration: 0.8, delay: 0.3, ease: "power2.out" });
      }, 1200);
      // Transition to analyzed
      setTimeout(() => {
        phaseRef.current = "analyzed";
        setPhase("analyzed");
      }, 3500);
    } else if (current === "analyzed") {
      // Reset everything
      gsap.killTweensOf(counterRef.current);
      gsap.killTweensOf(sidebarOpacity.current);
      gsap.killTweensOf(clusterLabelOpacity.current);
      gsap.killTweensOf(glowIntensity.current);
      particlesRef.current.forEach(p => gsap.killTweensOf(p));
      counterRef.current.value = 0;
      sidebarOpacity.current.value = 0;
      clusterLabelOpacity.current.value = 0;
      glowIntensity.current.value = 0;
      initParticles(w, h);
      phaseRef.current = "waiting";
      setPhase("waiting");
      setShowHint(true);
    }
  }, [initParticles]);

  // ─── Render loop ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let w = window.innerWidth;
    let h = window.innerHeight;
    dimensionsRef.current = { w, h };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.scale(devicePixelRatio, devicePixelRatio);
      dimensionsRef.current = { w, h };
    };
    resize();
    window.addEventListener("resize", resize);

    initParticles(w, h);

    const hexToRgb = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return { r, g, b };
    };

    const render = () => {
      const phase = phaseRef.current;
      const particles = particlesRef.current;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      if (phase === "waiting") {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // ─── Update & draw particles ────────────────────────────────
      for (const p of particles) {
        // Movement (streaming/contaminating/chaos)
        if (phase === "streaming" || phase === "contaminating" || phase === "chaos") {
          p.y += p.vy;
          p.x += p.vx;
          // Fade in
          if (p.alpha < p.targetAlpha) p.alpha = Math.min(p.alpha + 0.015, p.targetAlpha);
          // Wrap around
          if (p.y > h + 30) {
            p.y = -30;
            p.x = Math.random() * w;
          }
        }

        // Determine color
        let r = 200, g = 200, b = 200;
        if (phase === "contaminating" || phase === "chaos" || phase === "clustering" || phase === "analyzed") {
          const tc = hexToRgb(p.targetColor);
          if (phase === "contaminating" && p.fake) {
            // Lerp to red
            const t = Math.min(1, p.alpha);
            r = Math.round(200 + (tc.r - 200) * t);
            g = Math.round(200 + (tc.g - 200) * t);
            b = Math.round(200 + (tc.b - 200) * t);
          } else {
            r = tc.r; g = tc.g; b = tc.b;
          }
        }

        // Draw glow behind particle in clustering/analyzed
        if ((phase === "clustering" || phase === "analyzed") && glowIntensity.current.value > 0) {
          const gi = glowIntensity.current.value;
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 20 * gi);
          gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.3 * gi * p.alpha})`);
          gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = gradient;
          ctx.fillRect(p.x - 20, p.y - 20, 40, 40);
        }

        // Draw text
        ctx.font = `${p.fontSize}px "SF Mono", "Fira Code", monospace`;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha})`;

        if (phase === "clustering" || phase === "analyzed") {
          // Draw as dot + short text
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha * 0.9})`;
          ctx.fill();
        } else {
          // Draw text snippet
          const displayText = p.text.slice(0, 60) + (p.text.length > 60 ? "..." : "");
          ctx.fillText(displayText, p.x, p.y);
        }
      }

      // ─── Cluster labels ─────────────────────────────────────────
      if ((phase === "clustering" || phase === "analyzed") && clusterLabelOpacity.current.value > 0) {
        const labelAlpha = clusterLabelOpacity.current.value;
        for (const cl of CLUSTERS) {
          const cx = cl.x * (w - SIDEBAR_WIDTH);
          const cy = cl.y * h;
          const rgb = hexToRgb(cl.color);

          // Cluster halo
          const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cl.radius * 1.2);
          gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.08 * labelAlpha})`);
          gradient.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.03 * labelAlpha})`);
          gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cx, cy, cl.radius * 1.2, 0, Math.PI * 2);
          ctx.fill();

          // Label
          ctx.font = `bold 12px "SF Mono", monospace`;
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.9 * labelAlpha})`;
          ctx.textAlign = "center";
          ctx.fillText(cl.label, cx, cy - cl.radius - 16);
          ctx.font = `11px "SF Mono", monospace`;
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 * labelAlpha})`;
          ctx.fillText(cl.count + " comments", cx, cy - cl.radius - 2);
          ctx.textAlign = "left";
        }
      }

      // ─── Sidebar ────────────────────────────────────────────────
      if (sidebarOpacity.current.value > 0) {
        const so = sidebarOpacity.current.value;
        const sx = w - SIDEBAR_WIDTH;

        // Background
        ctx.fillStyle = `rgba(10, 10, 10, ${0.92 * so})`;
        ctx.fillRect(sx, 0, SIDEBAR_WIDTH, h);

        // Border
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * so})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();

        const textX = sx + 28;
        let ty = 50;

        // Title
        ctx.font = `bold 18px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * so})`;
        ctx.fillText("DOCKETLENS", textX, ty);
        ty += 14;
        ctx.font = `11px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * so})`;
        ctx.fillText("FCC-2017-0200 | Net Neutrality", textX, ty);

        ty += 45;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * so})`;
        ctx.fillRect(textX, ty, SIDEBAR_WIDTH - 56, 1);
        ty += 30;

        // Stats
        const drawStat = (label: string, value: string, color: string) => {
          ctx.font = `11px "SF Mono", monospace`;
          ctx.fillStyle = `rgba(180, 180, 180, ${0.6 * so})`;
          ctx.fillText(label, textX, ty);
          ty += 22;
          ctx.font = `bold 28px "SF Mono", monospace`;
          const rgb = hexToRgb(color);
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.95 * so})`;
          ctx.fillText(value, textX, ty);
          ty += 38;
        };

        drawStat("TOTAL COMMENTS", STATS.total, "#ffffff");
        drawStat("PROCESSING TIME", STATS.processingTime, "#06b6d4");

        // Divider
        ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * so})`;
        ctx.fillRect(textX, ty, SIDEBAR_WIDTH - 56, 1);
        ty += 30;

        // Campaign detection
        ctx.font = `bold 13px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(239, 68, 68, ${0.9 * so})`;
        ctx.fillText(`${STATS.campaigns} CAMPAIGNS DETECTED`, textX, ty);
        ty += 30;

        drawStat("MANUFACTURED COMMENTS", STATS.fake, "#ef4444");
        ctx.font = `13px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(239, 68, 68, ${0.5 * so})`;
        ctx.fillText(STATS.fakePercent + " of total", textX, ty - 16);
        ty += 12;

        drawStat("UNIQUE VOICES", STATS.unique, "#22c55e");
        ctx.font = `13px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(34, 197, 94, ${0.5 * so})`;
        ctx.fillText(STATS.uniquePercent + " of total", textX, ty - 16);
        ty += 25;

        // Divider
        ctx.fillStyle = `rgba(255, 255, 255, ${0.15 * so})`;
        ctx.fillRect(textX, ty, SIDEBAR_WIDTH - 56, 1);
        ty += 30;

        // Campaign list
        ctx.font = `bold 12px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * so})`;
        ctx.fillText("IDENTIFIED CAMPAIGNS", textX, ty);
        ty += 24;

        for (let i = 0; i < 4; i++) {
          const cl = CLUSTERS[i];
          const rgb = hexToRgb(cl.color);
          // Dot
          ctx.beginPath();
          ctx.arc(textX + 5, ty - 4, 5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.9 * so})`;
          ctx.fill();
          // Label
          ctx.font = `11px "SF Mono", monospace`;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * so})`;
          ctx.fillText(cl.label, textX + 18, ty);
          ty += 18;
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.5 * so})`;
          ctx.fillText(cl.count, textX + 18, ty);
          ty += 28;
        }
      }

      // ─── Counter overlay (streaming phase) ──────────────────────
      if (phase === "streaming" || phase === "contaminating" || phase === "chaos") {
        const count = Math.floor(counterRef.current.value);
        const formatted = count.toLocaleString();
        ctx.font = `bold 48px "SF Mono", monospace`;
        ctx.fillStyle = `rgba(255, 255, 255, 0.12)`;
        ctx.textAlign = "right";
        ctx.fillText(formatted, w - 40, h - 40);
        ctx.textAlign = "left";
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [initParticles]);

  // ─── Input handling ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent && e.key !== " " && e.key !== "Enter" && e.key !== "ArrowRight") return;
      advancePhase();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("click", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("click", handler);
    };
  }, [advancePhase]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Phase indicator */}
      <div className="absolute top-6 left-6 z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            phase === "analyzed" ? "bg-green-500" :
            phase === "clustering" ? "bg-cyan-500 animate-pulse" :
            phase === "chaos" || phase === "contaminating" ? "bg-red-500 animate-pulse" :
            phase === "streaming" ? "bg-white animate-pulse" :
            "bg-gray-600"
          }`} />
          <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
            {phase === "waiting" ? "Ready" :
             phase === "streaming" ? "Ingesting" :
             phase === "contaminating" ? "Scanning" :
             phase === "chaos" ? "Patterns Detected" :
             phase === "clustering" ? "Clustering" :
             "Analysis Complete"}
          </span>
        </div>
      </div>

      {/* Click hint */}
      {showHint && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="text-white/20 font-mono text-sm tracking-widest uppercase mb-2">
              DocketLens
            </div>
            <div className="text-white/10 font-mono text-xs tracking-wider">
              Press space or click to begin
            </div>
          </div>
        </div>
      )}

      {/* Bottom hint for advancing */}
      {phase !== "waiting" && phase !== "analyzed" && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <div className="text-white/10 font-mono text-[10px] tracking-wider uppercase">
            {phase === "streaming" ? "Click to reveal patterns" :
             phase === "contaminating" || phase === "chaos" ? "Click to cluster" :
             phase === "clustering" ? "Analyzing..." :
             ""}
          </div>
        </div>
      )}
    </div>
  );
}
