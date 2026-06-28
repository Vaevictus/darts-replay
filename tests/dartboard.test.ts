import { describe, it, expect } from "vitest";
import { buildBoardSvg, RINGS, SECTOR_ORDER } from "@shared/dartboard.js";
import type { Dart } from "@shared/types.js";

const dart = (x: number, y: number): Dart => ({
  index: 1,
  name: "T20",
  number: 20,
  bed: "Triple",
  multiplier: 3,
  points: 60,
  coords: { x, y },
});

describe("dartboard geometry", () => {
  it("has 20 sectors and sane ring ordering", () => {
    expect(SECTOR_ORDER).toHaveLength(20);
    expect(SECTOR_ORDER[0]).toBe(20);
    expect(RINGS.bullInner).toBeLessThan(RINGS.bullOuter);
    expect(RINGS.tripleInner).toBeLessThan(RINGS.tripleOuter);
    expect(RINGS.doubleInner).toBeLessThan(RINGS.doubleOuter);
    expect(RINGS.doubleOuter).toBe(1);
  });

  it("the captured T1 sample lands inside the triple band", () => {
    // From live /api/state: T1 at (0.2099, 0.5770).
    const r = Math.hypot(0.2099, 0.577);
    expect(r).toBeGreaterThan(RINGS.tripleInner);
    expect(r).toBeLessThan(RINGS.tripleOuter);
  });
});

describe("buildBoardSvg", () => {
  it("returns a well-formed svg", () => {
    const svg = buildBoardSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("viewBox");
  });

  it("plots a marker per dart with coordinates and a y-flip to screen space", () => {
    const svg = buildBoardSvg([dart(0.2, 0.6)]);
    // +y up in board space becomes -y in screen space.
    expect(svg).toContain('cy="-0.6000"');
    expect(svg).toContain('cx="0.2000"');
  });

  it("skips darts without coordinates", () => {
    const noCoord: Dart = { ...dart(0, 0), coords: null };
    const svg = buildBoardSvg([noCoord]);
    // only the bull circles + rings, no marker text "1"
    expect(svg).not.toContain('font-weight="bold">1</text>');
  });
});
