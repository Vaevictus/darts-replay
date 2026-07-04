import { useEffect, useRef } from "react";
import { RINGS } from "@shared/dartboard.js";

export type HeatmapMode = "glow" | "ramp";
// "relative": normalize to the densest spot (clusters always read red — good for
// small samples). "absolute": fixed scale, so red only appears once darts really
// pile up in one spot.
export type HeatmapScale = "relative" | "absolute";

// Accumulated alpha (~4 overlapping darts) that reads as full red in absolute mode.
const ABSOLUTE_REF = 160;

// Default per-dart kernel radius as a fraction of the canvas (the `kernel` prop;
// tunable in Settings via useHeatmapKernel). Kept small on purpose:
// blob_board_radius = kernel * 2.3 ≈ 0.069 (≈ 12 mm on a real board), so a
// dart's heat is roughly one dart-width — hits must be practically on top of
// each other to build a hot spot, rather than "anywhere in the same segment".
const DEFAULT_KERNEL = 0.03;

interface Pt {
  x: number;
  y: number;
}

/** 256-entry blue→cyan→green→yellow→red lookup for the ramp colorizer. Built once
 * (the palette is constant), lazily so it isn't created until a ramp render needs it. */
let paletteCache: Uint8ClampedArray | null = null;
function palette(): Uint8ClampedArray {
  if (paletteCache) return paletteCache;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 1;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0.0, "#2b3a8f");
  g.addColorStop(0.25, "#2aa9e0");
  g.addColorStop(0.5, "#2ecc71");
  g.addColorStop(0.75, "#f1c40f");
  g.addColorStop(1.0, "#e02020");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  paletteCache = ctx.getImageData(0, 0, 256, 1).data;
  return paletteCache;
}

/**
 * Density heatmap of dart positions. Coords are normalized (+x right, +y up,
 * double-ring outer edge ≈ 1.0), drawn over a faint board reference.
 * - "glow": additive orange blobs — clusters glow brighter/white.
 * - "ramp": accumulate density, then colorize blue (sparse) → red (dense),
 *   normalized to the densest spot so clustering reads clearly on small samples.
 */
export function Heatmap({
  coords,
  mode = "ramp",
  scale = "absolute",
  kernel = DEFAULT_KERNEL,
  size = 200,
}: {
  coords: Pt[];
  mode?: HeatmapMode;
  scale?: HeatmapScale;
  kernel?: number; // per-dart heat radius, fraction of the canvas
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const c = px / 2;
    const R = px / 2 / 1.15; // margin so out-board darts still land inside
    const toX = (x: number) => c + x * R;
    const toY = (y: number) => c - y * R; // math y-up -> screen y-down
    const blob = px * kernel;

    ctx.clearRect(0, 0, px, px);

    // Faint board reference: rings + sector spokes.
    ctx.lineWidth = Math.max(1, px * 0.004);
    ctx.strokeStyle = "rgba(170,190,205,0.16)";
    for (const r of [RINGS.doubleOuter, RINGS.doubleInner, RINGS.tripleOuter, RINGS.tripleInner, RINGS.bullOuter, RINGS.bullInner]) {
      ctx.beginPath();
      ctx.arc(c, c, r * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const rad = ((i * 18 + 9) * Math.PI) / 180; // sector boundaries, clockwise from top
      ctx.beginPath();
      ctx.moveTo(c + Math.sin(rad) * RINGS.bullOuter * R, c - Math.cos(rad) * RINGS.bullOuter * R);
      ctx.lineTo(c + Math.sin(rad) * R, c - Math.cos(rad) * R);
      ctx.stroke();
    }

    if (!coords.length) return;

    if (mode === "glow") {
      // Additive orange — overlaps sum toward white-hot.
      ctx.globalCompositeOperation = "lighter";
      for (const p of coords) {
        const x = toX(p.x);
        const y = toY(p.y);
        const g = ctx.createRadialGradient(x, y, 0, x, y, blob);
        g.addColorStop(0, "rgba(255,150,40,0.5)");
        g.addColorStop(0.5, "rgba(255,80,30,0.2)");
        g.addColorStop(1, "rgba(255,60,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, blob, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      return;
    }

    // ramp: accumulate alpha on an offscreen canvas, colorize, composite over board.
    const heat = document.createElement("canvas");
    heat.width = px;
    heat.height = px;
    const hctx = heat.getContext("2d");
    if (!hctx) return;
    for (const p of coords) {
      const x = toX(p.x);
      const y = toY(p.y);
      const g = hctx.createRadialGradient(x, y, 0, x, y, blob);
      g.addColorStop(0, "rgba(0,0,0,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      hctx.fillStyle = g;
      hctx.beginPath();
      hctx.arc(x, y, blob, 0, Math.PI * 2);
      hctx.fill();
    }
    const img = hctx.getImageData(0, 0, px, px);
    const d = img.data;
    // Relative scaling needs the densest alpha; absolute uses a fixed reference and
    // skips the scan. There's always at least one blob here (coords non-empty).
    let denom = ABSOLUTE_REF;
    if (scale === "relative") {
      let maxA = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > maxA) maxA = d[i];
      if (maxA === 0) return;
      denom = maxA;
    }
    const pal = palette();
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (!a) continue;
      const t = Math.min(1, a / denom); // density, relative-to-max or absolute
      const j = Math.min(255, Math.round(t * 255)) * 4;
      d[i] = pal[j];
      d[i + 1] = pal[j + 1];
      d[i + 2] = pal[j + 2];
      d[i + 3] = Math.round(t * 215);
    }
    hctx.putImageData(img, 0, 0);
    ctx.drawImage(heat, 0, 0);
  }, [coords, mode, scale, kernel, size]);

  return <canvas ref={ref} className="heatmap__canvas" style={{ width: size, height: size }} />;
}
