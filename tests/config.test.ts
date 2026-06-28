import { describe, it, expect } from "vitest";
import { merge, validateConfigPatch, DEFAULT_CONFIG } from "../server/src/config.js";

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
});
