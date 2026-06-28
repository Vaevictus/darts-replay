// Pure visit state machine. Hybrid "first-wins" finish: a visit ends on the 3rd
// dart (after a short settle grace), OR on a takeout, OR on an inactivity timeout
// — whichever happens first. DOM-free and fully deterministic: given the same
// (state, signal, now, config) it always returns the same (state, effects).

import type { Dart, Visit, EndReason, Config } from "./types.js";

export type Phase = "IDLE" | "READY" | "RECORDING" | "COLLECTING";

export type TimerName = "inactivity" | "finalize" | "collect";

/** Inputs to the machine. `at` is epoch-ms supplied by the caller. */
export type Signal =
  | { type: "DART"; dart: Dart; at: number }
  | { type: "TAKEOUT"; at: number } // board entered "Takeout" — visit over, darts usually still in board
  | { type: "COLLECTED"; at: number } // darts physically removed (throws cleared) — start re-arm countdown
  | { type: "BOARD_IDLE"; at: number }
  | { type: "BOARD_READY"; at: number }
  | { type: "TIMER"; name: TimerName; at: number };

/** Side effects the host (server) is responsible for carrying out. */
export type Effect =
  | { type: "START_TIMER"; name: TimerName; ms: number }
  | { type: "CANCEL_TIMER"; name: TimerName }
  | { type: "EXTRACT_CLIP"; visitId: string; startMs: number; endMs: number }
  | { type: "VISIT_READY"; visit: Visit };

export interface MachineState {
  phase: Phase;
  darts: Dart[];
  startedAt: number | null;
  takeoutSeen: boolean;
  seq: number;
}

export function initialState(): MachineState {
  return { phase: "IDLE", darts: [], startedAt: null, takeoutSeen: false, seq: 0 };
}

export interface StepResult {
  state: MachineState;
  effects: Effect[];
}

/** Visit-finish config knobs (subset of Config.visit + recorder roll). */
export interface FsmConfig {
  inactivityTimeoutMs: number;
  thirdDartGraceMs: number;
  collectTimeoutMs: number;
  preRollMs: number;
  postRollMs: number;
}

export function fsmConfig(config: Config): FsmConfig {
  return {
    inactivityTimeoutMs: config.visit.inactivityTimeoutMs,
    thirdDartGraceMs: config.visit.thirdDartGraceMs,
    collectTimeoutMs: config.visit.collectTimeoutMs,
    preRollMs: config.recorder.preRollMs,
    postRollMs: config.recorder.postRollMs,
  };
}

function deterministicId(seq: number, startedAt: number): string {
  return `v${String(seq).padStart(4, "0")}_${startedAt}`;
}

function buildVisit(state: MachineState, finishedAt: number, endReason: EndReason): Visit {
  const startedAt = state.startedAt ?? finishedAt;
  return {
    id: deterministicId(state.seq, startedAt),
    seq: state.seq,
    darts: state.darts,
    totalPoints: state.darts.reduce((sum, d) => sum + d.points, 0),
    startedAt,
    finishedAt,
    endReason,
    clipUrl: null,
  };
}

/**
 * Lock the current visit: cancel pending finish timers, request the clip, push
 * the visit, and move to COLLECTING. `collected` is true when the darts are
 * already physically out of the board (so the re-arm countdown can start now);
 * otherwise we wait in COLLECTING for the COLLECTED signal.
 */
function finish(
  state: MachineState,
  now: number,
  reason: EndReason,
  cfg: FsmConfig,
  collected: boolean,
): StepResult {
  const visit = buildVisit(state, now, reason);
  const effects: Effect[] = [
    { type: "CANCEL_TIMER", name: "inactivity" },
    { type: "CANCEL_TIMER", name: "finalize" },
    {
      type: "EXTRACT_CLIP",
      visitId: visit.id,
      startMs: visit.startedAt - cfg.preRollMs,
      endMs: now + cfg.postRollMs,
    },
    { type: "VISIT_READY", visit },
  ];

  if (collected) effects.push({ type: "START_TIMER", name: "collect", ms: cfg.collectTimeoutMs });

  return {
    state: { ...state, phase: "COLLECTING", takeoutSeen: collected },
    effects,
  };
}

function startVisit(seq: number, dart: Dart, now: number, cfg: FsmConfig): StepResult {
  return {
    state: {
      phase: "RECORDING",
      darts: [{ ...dart, index: 1 }],
      startedAt: now,
      takeoutSeen: false,
      seq: seq + 1,
    },
    effects: [{ type: "START_TIMER", name: "inactivity", ms: cfg.inactivityTimeoutMs }],
  };
}

function rearmed(seq: number): MachineState {
  return { phase: "READY", darts: [], startedAt: null, takeoutSeen: false, seq };
}

export function step(state: MachineState, signal: Signal, cfg: FsmConfig): StepResult {
  const now = signal.at;

  // Board idle short-circuits from any phase: drop the in-flight visit.
  if (signal.type === "BOARD_IDLE") {
    if (state.phase === "IDLE") return { state, effects: [] };
    return {
      state: { ...rearmed(state.seq), phase: "IDLE" },
      effects: [
        { type: "CANCEL_TIMER", name: "inactivity" },
        { type: "CANCEL_TIMER", name: "finalize" },
        { type: "CANCEL_TIMER", name: "collect" },
      ],
    };
  }

  switch (state.phase) {
    case "IDLE":
    case "READY": {
      if (signal.type === "DART") return startVisit(state.seq, signal.dart, now, cfg);
      if (signal.type === "BOARD_READY") return { state: rearmed(state.seq), effects: [] };
      return { state, effects: [] };
    }

    case "RECORDING": {
      if (signal.type === "DART") {
        const darts = [...state.darts, { ...signal.dart, index: state.darts.length + 1 }];
        const next = { ...state, darts };
        if (darts.length >= 3) {
          // Third dart: wait a short grace before locking so coords can settle.
          return {
            state: next,
            effects: [
              { type: "CANCEL_TIMER", name: "inactivity" },
              { type: "START_TIMER", name: "finalize", ms: cfg.thirdDartGraceMs },
            ],
          };
        }
        return {
          state: next,
          effects: [{ type: "START_TIMER", name: "inactivity", ms: cfg.inactivityTimeoutMs }],
        };
      }
      // Takeout prompt: visit over, darts usually still in board -> finish, wait for COLLECTED.
      if (signal.type === "TAKEOUT") return finish(state, now, "takeout", cfg, false);
      // Darts removed before/without a takeout prompt (partial visit) -> finish + arm re-record.
      if (signal.type === "COLLECTED") return finish(state, now, "takeout", cfg, true);
      if (signal.type === "TIMER" && signal.name === "finalize")
        return finish(state, now, "third-dart", cfg, false);
      if (signal.type === "TIMER" && signal.name === "inactivity")
        return finish(state, now, "timeout", cfg, true);
      return { state, effects: [] };
    }

    case "COLLECTING": {
      // Re-arm countdown starts only once the darts are physically collected.
      if (signal.type === "COLLECTED") {
        if (state.takeoutSeen) return { state, effects: [] };
        return {
          state: { ...state, takeoutSeen: true },
          effects: [{ type: "START_TIMER", name: "collect", ms: cfg.collectTimeoutMs }],
        };
      }
      if (signal.type === "TAKEOUT") return { state, effects: [] }; // already finished
      if (signal.type === "TIMER" && signal.name === "collect")
        return { state: rearmed(state.seq), effects: [] };
      // Player collected fast and is already throwing the next visit.
      if (signal.type === "DART") {
        const res = startVisit(state.seq, signal.dart, now, cfg);
        return { state: res.state, effects: [{ type: "CANCEL_TIMER", name: "collect" }, ...res.effects] };
      }
      return { state, effects: [] };
    }
  }
}
