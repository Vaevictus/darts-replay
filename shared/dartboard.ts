// Pure SVG dartboard renderer. Plots normalized darts ( +x right, +y up, the
// double-ring outer edge == radius 1.0 ) onto a standard board. DOM-free: returns
// an SVG string usable from the server or injected via dangerouslySetInnerHTML.

import type { Dart } from "./types.js";

/** Clockwise sector order starting at the top (20). */
export const SECTOR_ORDER = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

/** Ring radii normalized so the double outer edge is 1.0 (standard board, 170mm). */
export const RINGS = {
  bullInner: 6.35 / 170,
  bullOuter: 15.9 / 170,
  tripleInner: 99 / 170,
  tripleOuter: 107 / 170,
  doubleInner: 162 / 170,
  doubleOuter: 1.0,
};

const COLORS = {
  black: "#1b1b1b",
  cream: "#e8d9a8",
  red: "#c8302b",
  green: "#1f8a4c",
  wire: "#cfcfcf",
  marker: "#ffffff",
  markerStroke: "#101010",
};

/** Point on the board (math coords, y up) at radius r and clockwise angle from top. */
function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), r * Math.cos(rad)];
}

/** SVG path for a ring wedge between radii [r1,r2] and angles [a,b], y flipped to screen space. */
function wedge(r1: number, r2: number, a: number, b: number): string {
  const step = 2;
  const pts: string[] = [];
  // outer arc a -> b
  for (let ang = a; ang <= b + 0.001; ang += step) {
    const [x, y] = polar(r2, ang);
    pts.push(`${x.toFixed(4)},${(-y).toFixed(4)}`);
  }
  // inner arc b -> a
  for (let ang = b; ang >= a - 0.001; ang -= step) {
    const [x, y] = polar(r1, ang);
    pts.push(`${x.toFixed(4)},${(-y).toFixed(4)}`);
  }
  return `M${pts.join(" L")} Z`;
}

export interface BoardOptions {
  showNumbers?: boolean;
  markerRadius?: number;
}

/** Build the full board SVG with the supplied darts plotted. */
export function buildBoardSvg(darts: Dart[] = [], opts: BoardOptions = {}): string {
  const { showNumbers = true, markerRadius = 0.05 } = opts;
  const parts: string[] = [];

  // Backing disc just outside the double ring (the "out" area).
  parts.push(`<circle cx="0" cy="0" r="1.18" fill="#0a0a0a"/>`);

  for (let i = 0; i < 20; i++) {
    const center = i * 18;
    const a = center - 9;
    const b = center + 9;
    const dark = i % 2 === 0; // 20 is dark/black single + red beds
    const singleFill = dark ? COLORS.black : COLORS.cream;
    const ringFill = dark ? COLORS.red : COLORS.green;

    // inner single, triple bed, outer single, double bed
    parts.push(`<path d="${wedge(RINGS.bullOuter, RINGS.tripleInner, a, b)}" fill="${singleFill}"/>`);
    parts.push(`<path d="${wedge(RINGS.tripleInner, RINGS.tripleOuter, a, b)}" fill="${ringFill}"/>`);
    parts.push(`<path d="${wedge(RINGS.tripleOuter, RINGS.doubleInner, a, b)}" fill="${singleFill}"/>`);
    parts.push(`<path d="${wedge(RINGS.doubleInner, RINGS.doubleOuter, a, b)}" fill="${ringFill}"/>`);
  }

  // Sector wires.
  for (let i = 0; i < 20; i++) {
    const [x, y] = polar(RINGS.doubleOuter, i * 18 + 9);
    parts.push(
      `<line x1="0" y1="0" x2="${x.toFixed(4)}" y2="${(-y).toFixed(4)}" stroke="${COLORS.wire}" stroke-width="0.004"/>`,
    );
  }
  for (const r of [RINGS.tripleInner, RINGS.tripleOuter, RINGS.doubleInner, RINGS.doubleOuter]) {
    parts.push(`<circle cx="0" cy="0" r="${r}" fill="none" stroke="${COLORS.wire}" stroke-width="0.004"/>`);
  }

  // Bulls.
  parts.push(`<circle cx="0" cy="0" r="${RINGS.bullOuter}" fill="${COLORS.green}" stroke="${COLORS.wire}" stroke-width="0.004"/>`);
  parts.push(`<circle cx="0" cy="0" r="${RINGS.bullInner}" fill="${COLORS.red}" stroke="${COLORS.wire}" stroke-width="0.004"/>`);

  // Numbers around the outside.
  if (showNumbers) {
    for (let i = 0; i < 20; i++) {
      const [x, y] = polar(1.1, i * 18);
      parts.push(
        `<text x="${x.toFixed(3)}" y="${(-y).toFixed(3)}" font-size="0.11" fill="#f0f0f0" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${SECTOR_ORDER[i]}</text>`,
      );
    }
  }

  // Dart markers.
  darts.forEach((d, i) => {
    if (!d.coords) return;
    const sx = d.coords.x;
    const sy = -d.coords.y;
    parts.push(
      `<circle cx="${sx.toFixed(4)}" cy="${sy.toFixed(4)}" r="${markerRadius}" fill="${COLORS.marker}" stroke="${COLORS.markerStroke}" stroke-width="0.012"/>`,
    );
    parts.push(
      `<text x="${sx.toFixed(4)}" y="${sy.toFixed(4)}" font-size="${(markerRadius * 1.1).toFixed(3)}" fill="${COLORS.markerStroke}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="bold">${i + 1}</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label="Dartboard showing darts thrown">${parts.join("")}</svg>`;
}
