import { describe, it, expect } from "vitest";
import { boardStateToSignals, classifyStatus, toDarts } from "@shared/board.js";
import type { RawBoardState } from "@shared/types.js";

function state(over: Partial<RawBoardState>): RawBoardState {
  return {
    connected: true,
    running: true,
    status: "Throw",
    event: "Throw",
    numThrows: 0,
    throws: [],
    ...over,
  };
}

const t = (name: string, number: number, multiplier: number, bed: string) => ({
  segment: { name, number, bed, multiplier },
  coords: { x: 0.1, y: 0.5 },
});

describe("classifyStatus", () => {
  it("maps known-ish strings to phases", () => {
    expect(classifyStatus("Stopped")).toBe("idle");
    expect(classifyStatus("Calibration")).toBe("idle");
    expect(classifyStatus("Takeout")).toBe("takeout");
    expect(classifyStatus("Throw")).toBe("throwing");
    expect(classifyStatus("Started")).toBe("ready");
  });
});

describe("toDarts", () => {
  it("normalizes throws with 1-based index and computed points", () => {
    const darts = toDarts(state({ numThrows: 1, throws: [t("T20", 20, 3, "Triple")] }));
    expect(darts[0]).toMatchObject({ index: 1, name: "T20", points: 60, multiplier: 3 });
    expect(darts[0].coords).toEqual({ x: 0.1, y: 0.5 });
  });
});

describe("boardStateToSignals", () => {
  it("emits a DART for each newly appended throw", () => {
    const prev = state({ numThrows: 1, throws: [t("T20", 20, 3, "Triple")] });
    const next = state({
      numThrows: 3,
      throws: [t("T20", 20, 3, "Triple"), t("S5", 5, 1, "SingleOuter"), t("D16", 16, 2, "Double")],
    });
    const sigs = boardStateToSignals(prev, next, 1000);
    const darts = sigs.filter((s) => s.type === "DART");
    expect(darts).toHaveLength(2);
    expect(darts[0]).toMatchObject({ type: "DART" });
  });

  it("emits COLLECTED when the board clears after a visit", () => {
    const prev = state({ numThrows: 3, throws: [t("T20", 20, 3, "Triple")] });
    const next = state({ status: "Throw", numThrows: 0, throws: [] });
    const sigs = boardStateToSignals(prev, next, 2000);
    expect(sigs.some((s) => s.type === "COLLECTED")).toBe(true);
    expect(sigs.some((s) => s.type === "TAKEOUT")).toBe(false);
  });

  it("emits TAKEOUT on an explicit takeout status (darts still in board)", () => {
    const prev = state({ status: "Throw", numThrows: 3, throws: [t("T20", 20, 3, "Triple")] });
    const next = state({ status: "Takeout", numThrows: 3, throws: [t("T20", 20, 3, "Triple")] });
    const sigs = boardStateToSignals(prev, next, 3000);
    expect(sigs.some((s) => s.type === "TAKEOUT")).toBe(true);
    expect(sigs.some((s) => s.type === "COLLECTED")).toBe(false);
  });

  it("the first snapshot is a baseline — no phantom darts from leftovers", () => {
    const first = state({ status: "Takeout", numThrows: 3, throws: [t("T20", 20, 3, "Triple")] });
    expect(boardStateToSignals(null, first, 1000)).toEqual([]);
  });

  it("tolerates a state with the throws field omitted (0 darts)", () => {
    // The board sends {status:'Throw', numThrows:0} with NO throws key.
    const next = { connected: true, running: true, status: "Throw", event: "Manual reset", numThrows: 0 } as RawBoardState;
    expect(() => boardStateToSignals(null, next, 1000)).not.toThrow();
    expect(toDarts(next)).toEqual([]);
  });

  it("emits COLLECTED when throws goes from present to omitted", () => {
    const prev = state({ status: "Throw", numThrows: 3, throws: [t("T20", 20, 3, "Triple")] });
    const next = { connected: true, running: true, status: "Throw", event: "Manual reset", numThrows: 0 } as RawBoardState;
    expect(boardStateToSignals(prev, next, 2000).some((s) => s.type === "COLLECTED")).toBe(true);
  });

  it("emits BOARD_IDLE on disconnect", () => {
    const next = state({ connected: false });
    expect(boardStateToSignals(state({}), next, 4000).some((s) => s.type === "BOARD_IDLE")).toBe(true);
  });
});
