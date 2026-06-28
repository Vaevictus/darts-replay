import { describe, it, expect } from "vitest";
import { buildOverlaySvg } from "../server/src/share.js";
import { DEFAULT_CONFIG } from "../server/src/config.js";
import type { Visit, OverlayConfig, ShareOptions } from "../shared/types.js";

const visit: Visit = {
  id: "v0007_1000",
  seq: 7,
  darts: [{ index: 1, name: "T20", number: 20, bed: "Triple", multiplier: 3, points: 60, coords: { x: 0.1, y: 0.5 } }],
  totalPoints: 60,
  startedAt: 1000,
  finishedAt: 2000,
  endReason: "third-dart",
  clipUrl: "/clips/x.mp4",
  saved: false,
  rating: null,
  note: "",
};
const cal = DEFAULT_CONFIG.calibration.board;
const guides: OverlayConfig = { enabled: true, vertical: [0.5], horizontal: [0.4, 0.58] };
const allOn: ShareOptions = {
  burnBoard: true,
  burnGuides: true,
  burnDarts: true,
  burnCaption: true,
  host: "none",
  multi: "separate",
};

describe("buildOverlaySvg", () => {
  it("emits a well-formed svg sized to the frame", () => {
    const svg = buildOverlaySvg(1280, 720, visit, cal, guides, allOn);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1280"');
    expect(svg).toContain('height="720"');
  });

  it("places the board at the calibrated centre/scale and rotates it", () => {
    const svg = buildOverlaySvg(1000, 1000, visit, { ...cal, x: 0.5, y: 0.5, scale: 0.6, rotation: 30 }, guides, allOn);
    expect(svg).toContain("rotate(30 500 500)"); // about the frame centre
    expect(svg).toContain('width="600"'); // board box = scale*H
    expect(svg).toContain('x="200"'); // centred: 500 - 600/2
  });

  it("includes guide lines only when guides are enabled", () => {
    // The board itself draws <line> wires, so match the guide accent colour.
    expect(buildOverlaySvg(1000, 1000, visit, cal, guides, allOn)).toContain('stroke="#2bd576"');
    const off = buildOverlaySvg(1000, 1000, visit, cal, { enabled: false, vertical: [0.5], horizontal: [] }, allOn);
    expect(off).not.toContain('stroke="#2bd576"');
  });

  it("omits board/guides/caption when all toggles are off", () => {
    const none: ShareOptions = { ...allOn, burnBoard: false, burnGuides: false, burnDarts: false, burnCaption: false };
    const svg = buildOverlaySvg(800, 600, visit, cal, guides, none);
    expect(svg).not.toContain("<line"); // board off ⇒ no board wires either
    expect(svg).not.toContain("<text"); // no caption, and no board numbers (board off)
    expect(svg).toContain("<svg"); // still valid, just empty
  });

  it("adds dart markers only when burnDarts is on", () => {
    const opts = { ...allOn, burnGuides: false, burnCaption: false };
    const withDarts = buildOverlaySvg(800, 600, visit, cal, guides, { ...opts, burnDarts: true });
    const without = buildOverlaySvg(800, 600, visit, cal, guides, { ...opts, burnDarts: false });
    expect(withDarts.length).toBeGreaterThan(without.length);
  });
});
