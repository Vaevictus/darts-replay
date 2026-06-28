import { describe, it, expect } from "vitest";
import {
  step,
  initialState,
  type FsmConfig,
  type MachineState,
  type Signal,
  type Effect,
} from "@shared/state-machine.js";
import type { Dart } from "@shared/types.js";

const CFG: FsmConfig = {
  inactivityTimeoutMs: 8000,
  thirdDartGraceMs: 300,
  collectTimeoutMs: 3000,
  preRollMs: 800,
  postRollMs: 1200,
};

function dart(name: string, number: number, multiplier: number): Dart {
  return {
    index: 0,
    name,
    number,
    bed: multiplier === 3 ? "Triple" : multiplier === 2 ? "Double" : "SingleOuter",
    multiplier,
    points: number * multiplier,
    coords: { x: 0.1, y: 0.5 },
  };
}

/** Drive a sequence of signals, collecting all effects. */
function run(start: MachineState, signals: Signal[]) {
  let state = start;
  const effects: Effect[] = [];
  for (const s of signals) {
    const res = step(state, s, CFG);
    state = res.state;
    effects.push(...res.effects);
  }
  return { state, effects };
}

const effTypes = (effects: Effect[]) => effects.map((e) => e.type);
const visitReady = (effects: Effect[]) =>
  effects.find((e) => e.type === "VISIT_READY") as Extract<Effect, { type: "VISIT_READY" }> | undefined;
const extract = (effects: Effect[]) =>
  effects.find((e) => e.type === "EXTRACT_CLIP") as Extract<Effect, { type: "EXTRACT_CLIP" }> | undefined;

describe("visit state machine", () => {
  it("full 3-dart visit finishes on the finalize grace timer", () => {
    const { state, effects } = run(initialState(), [
      { type: "DART", dart: dart("T20", 20, 3), at: 1000 },
      { type: "DART", dart: dart("T20", 20, 3), at: 1500 },
      { type: "DART", dart: dart("S20", 20, 1), at: 2000 },
      { type: "TIMER", name: "finalize", at: 2300 },
    ]);

    expect(state.phase).toBe("COLLECTING");
    const v = visitReady(effects);
    expect(v?.visit.darts).toHaveLength(3);
    expect(v?.visit.totalPoints).toBe(140);
    expect(v?.visit.endReason).toBe("third-dart");
    expect(v?.visit.darts.map((d) => d.index)).toEqual([1, 2, 3]);

    // clip window honors pre/post roll around first dart..finish.
    const ex = extract(effects);
    expect(ex?.startMs).toBe(1000 - CFG.preRollMs);
    expect(ex?.endMs).toBe(2300 + CFG.postRollMs);
    expect(ex?.visitId).toBe(v?.visit.id);
  });

  it("third dart starts a finalize timer (not an immediate finish)", () => {
    const after2 = run(initialState(), [
      { type: "DART", dart: dart("T20", 20, 3), at: 1000 },
      { type: "DART", dart: dart("T20", 20, 3), at: 1500 },
    ]);
    const res = step(after2.state, { type: "DART", dart: dart("T20", 20, 3), at: 2000 }, CFG);
    expect(res.state.phase).toBe("RECORDING");
    expect(effTypes(res.effects)).toEqual(["CANCEL_TIMER", "START_TIMER"]);
    expect(visitReady(res.effects)).toBeUndefined();
  });

  it("2-dart visit: COLLECTED finishes it and arms the collect timer", () => {
    const { state, effects } = run(initialState(), [
      { type: "DART", dart: dart("D20", 20, 2), at: 1000 },
      { type: "DART", dart: dart("D20", 20, 2), at: 1500 },
      { type: "COLLECTED", at: 1800 },
    ]);
    expect(state.phase).toBe("COLLECTING");
    expect(state.takeoutSeen).toBe(true);
    const v = visitReady(effects);
    expect(v?.visit.endReason).toBe("takeout");
    expect(v?.visit.darts).toHaveLength(2);
    expect(effects.some((e) => e.type === "START_TIMER" && e.name === "collect")).toBe(true);
  });

  it("takeout prompt finishes the visit, but re-arm waits for COLLECTED", () => {
    // Real board: status->Takeout fires right after the 3rd dart, darts still in.
    const afterTakeout = run(initialState(), [
      { type: "DART", dart: dart("T20", 20, 3), at: 1000 },
      { type: "DART", dart: dart("T20", 20, 3), at: 1400 },
      { type: "DART", dart: dart("T20", 20, 3), at: 1800 },
      { type: "TAKEOUT", at: 1900 },
    ]);
    expect(afterTakeout.state.phase).toBe("COLLECTING");
    expect(afterTakeout.state.takeoutSeen).toBe(false);
    expect(visitReady(afterTakeout.effects)?.visit.darts).toHaveLength(3);
    expect(afterTakeout.effects.some((e) => e.type === "START_TIMER" && e.name === "collect")).toBe(
      false,
    );
    // Physically collecting the darts starts the re-arm countdown.
    const res = step(afterTakeout.state, { type: "COLLECTED", at: 5000 }, CFG);
    expect(res.state.takeoutSeen).toBe(true);
    expect(res.effects.some((e) => e.type === "START_TIMER" && e.name === "collect")).toBe(true);
  });

  it("single-dart visit finishes on the inactivity timeout", () => {
    const { state, effects } = run(initialState(), [
      { type: "DART", dart: dart("S5", 5, 1), at: 1000 },
      { type: "TIMER", name: "inactivity", at: 9000 },
    ]);
    expect(state.phase).toBe("COLLECTING");
    expect(visitReady(effects)?.visit.endReason).toBe("timeout");
  });

  it("re-arms to READY after the collect timer (full flow)", () => {
    const seq = run(initialState(), [
      { type: "DART", dart: dart("D20", 20, 2), at: 1000 },
      { type: "TAKEOUT", at: 1500 }, // visit finished, no timer yet
      { type: "COLLECTED", at: 3000 }, // darts removed -> start collect timer
      { type: "TIMER", name: "collect", at: 7000 }, // timer elapsed -> re-arm
    ]);
    expect(seq.state.phase).toBe("READY");
    expect(seq.state.darts).toHaveLength(0);
  });

  it("board idle mid-visit drops the visit with no clip", () => {
    const { state, effects } = run(initialState(), [
      { type: "DART", dart: dart("T20", 20, 3), at: 1000 },
      { type: "BOARD_IDLE", at: 1200 },
    ]);
    expect(state.phase).toBe("IDLE");
    expect(visitReady(effects)).toBeUndefined();
    expect(effects.some((e) => e.type === "CANCEL_TIMER" && e.name === "inactivity")).toBe(true);
  });

  it("a dart during COLLECTING starts the next visit and cancels the collect timer", () => {
    const collecting = run(initialState(), [
      { type: "DART", dart: dart("T20", 20, 3), at: 1000 },
      { type: "DART", dart: dart("T20", 20, 3), at: 1500 },
      { type: "DART", dart: dart("S20", 20, 1), at: 2000 },
      { type: "TIMER", name: "finalize", at: 2300 },
    ]);
    expect(collecting.state.phase).toBe("COLLECTING");

    const res = step(collecting.state, { type: "DART", dart: dart("T20", 20, 3), at: 5000 }, CFG);
    expect(res.state.phase).toBe("RECORDING");
    expect(res.state.darts).toHaveLength(1);
    expect(res.effects.some((e) => e.type === "CANCEL_TIMER" && e.name === "collect")).toBe(true);
  });

  it("assigns a monotonically increasing seq per visit", () => {
    const first = run(initialState(), [
      { type: "DART", dart: dart("S20", 20, 1), at: 1000 },
      { type: "COLLECTED", at: 1200 },
      { type: "TIMER", name: "collect", at: 4200 },
    ]);
    const second = step(first.state, { type: "DART", dart: dart("S20", 20, 1), at: 5000 }, CFG);
    expect(second.state.seq).toBe(2);
  });
});
