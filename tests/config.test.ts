import { describe, it, expect } from "vitest";
import { merge, validateConfigPatch, clipsDir, dataPath, DEFAULT_CONFIG } from "../server/src/config.js";

describe("merge", () => {
  it("overrides a scalar without touching other sections", () => {
    const out = merge(DEFAULT_CONFIG, { retainCount: 5 });
    expect(out.retainCount).toBe(5);
    expect(out.board).toEqual(DEFAULT_CONFIG.board);
  });

  it("merges a nested section, keeping sibling fields", () => {
    const out = merge(DEFAULT_CONFIG, { webcam: { fps: 60 } });
    expect(out.webcam.fps).toBe(60);
    expect(out.webcam.device).toBe(DEFAULT_CONFIG.webcam.device);
  });

  it("an empty patch is a structural no-op", () => {
    expect(merge(DEFAULT_CONFIG, {})).toEqual(DEFAULT_CONFIG);
  });

  it("deep-merges sharing.streamable, keeping sibling fields", () => {
    const out = merge(DEFAULT_CONFIG, { sharing: { defaultHost: "catbox", streamable: { email: "a@b.c" } } });
    expect(out.sharing.defaultHost).toBe("catbox");
    expect(out.sharing.streamable.email).toBe("a@b.c");
    expect(out.sharing.streamable.password).toBe(DEFAULT_CONFIG.sharing.streamable.password);
    expect(out.sharing.burnBoard).toBe(DEFAULT_CONFIG.sharing.burnBoard);
  });

  it("deep-merges calibration.board, keeping sibling fields", () => {
    const out = merge(DEFAULT_CONFIG, { calibration: { board: { x: 0.25, show: true } } });
    expect(out.calibration.board.x).toBe(0.25);
    expect(out.calibration.board.show).toBe(true);
    expect(out.calibration.board.scale).toBe(DEFAULT_CONFIG.calibration.board.scale);
  });
});

describe("clipsDir", () => {
  it("resolves the default 'var/clips' under the data root, stripping the legacy prefix", () => {
    const dir = clipsDir(DEFAULT_CONFIG);
    // With DARTS_DATA unset the data root is <ROOT>/var, so both forms land in the same place.
    expect(dir).toBe(dataPath("clips"));
    expect(dir.endsWith("/clips")).toBe(true);
  });

  it("treats a bare relative clipDir as data-root-relative", () => {
    const cfg = { ...DEFAULT_CONFIG, recorder: { ...DEFAULT_CONFIG.recorder, clipDir: "clips" } };
    expect(clipsDir(cfg)).toBe(dataPath("clips"));
  });

  it("passes an absolute clipDir through unchanged", () => {
    const cfg = { ...DEFAULT_CONFIG, recorder: { ...DEFAULT_CONFIG.recorder, clipDir: "/mnt/clips" } };
    expect(clipsDir(cfg)).toBe("/mnt/clips");
  });
});

describe("validateConfigPatch", () => {
  it("accepts a well-formed patch and returns the sanitized subset", () => {
    const { patch, errors } = validateConfigPatch({
      board: { port: 4000 },
      webcam: { format: "h264", fps: 25 },
      retainCount: 5,
    });
    expect(errors).toEqual([]);
    expect(patch.board?.port).toBe(4000);
    expect(patch.webcam?.format).toBe("h264");
    expect(patch.retainCount).toBe(5);
  });

  it("rejects out-of-range and wrong-typed values", () => {
    const cases: unknown[] = [
      { board: { port: 70000 } },
      { webcam: { fps: "30" } },
      { webcam: { format: "xyz" } },
      { webcam: { encoder: "av1" } },
      { retainCount: -1 },
      { recorder: { ringSeconds: 1 } },
      "not-an-object",
    ];
    for (const input of cases) {
      expect(validateConfigPatch(input).errors.length).toBeGreaterThan(0);
    }
  });

  it("ignores unknown keys but keeps recognized siblings", () => {
    const { patch, errors } = validateConfigPatch({ bogus: 1, board: { nope: 2, port: 5000 } });
    expect(errors).toEqual([]);
    expect(patch.board?.port).toBe(5000);
    expect((patch.board as Record<string, unknown>)?.nope).toBeUndefined();
    expect((patch as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("accepts valid orientation and flips", () => {
    const { patch, errors } = validateConfigPatch({ webcam: { rotation: 90, flipH: true, flipV: false } });
    expect(errors).toEqual([]);
    expect(patch.webcam?.rotation).toBe(90);
    expect(patch.webcam?.flipH).toBe(true);
    expect(patch.webcam?.flipV).toBe(false);
  });

  it("rejects a non-quarter-turn rotation and non-boolean flip", () => {
    expect(validateConfigPatch({ webcam: { rotation: 45 } }).errors.length).toBeGreaterThan(0);
    expect(validateConfigPatch({ webcam: { flipH: "yes" } }).errors.length).toBeGreaterThan(0);
  });

  it("accepts a valid calibration.board patch", () => {
    const { patch, errors } = validateConfigPatch({
      calibration: { board: { x: 0.4, y: 0.6, scale: 0.7, rotation: 180, opacity: 0.5, show: true } },
    });
    expect(errors).toEqual([]);
    expect(patch.calibration?.board).toEqual({ x: 0.4, y: 0.6, scale: 0.7, rotation: 180, opacity: 0.5, show: true });
  });

  it("rejects out-of-range calibration values", () => {
    expect(validateConfigPatch({ calibration: { board: { x: 1.5 } } }).errors.length).toBeGreaterThan(0);
    expect(validateConfigPatch({ calibration: { board: { opacity: -0.1 } } }).errors.length).toBeGreaterThan(0);
    expect(validateConfigPatch({ calibration: { board: { rotation: 400 } } }).errors.length).toBeGreaterThan(0);
  });

  it("accepts a valid sharing patch (incl. empty streamable creds)", () => {
    const { patch, errors } = validateConfigPatch({
      sharing: { defaultHost: "streamable", burnDarts: true, streamable: { email: "x@y.z", password: "" } },
    });
    expect(errors).toEqual([]);
    expect(patch.sharing?.defaultHost).toBe("streamable");
    expect(patch.sharing?.burnDarts).toBe(true);
    expect(patch.sharing?.streamable).toEqual({ email: "x@y.z", password: "" });
  });

  it("rejects a bad sharing host and non-boolean burn flag", () => {
    expect(validateConfigPatch({ sharing: { defaultHost: "youtube" } }).errors.length).toBeGreaterThan(0);
    expect(validateConfigPatch({ sharing: { burnGuides: "yes" } }).errors.length).toBeGreaterThan(0);
  });
});
