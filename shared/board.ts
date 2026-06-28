// Pure helpers that turn raw /api/state payloads into normalized darts and
// into the signal stream the visit state machine consumes. DOM-free.

import type { RawBoardState, RawThrow, Dart } from "./types.js";
import type { Signal } from "./state-machine.js";

/**
 * Coarse classification of the board manager's `status` string.
 *
 * The exact live strings still need confirming against a real throw/takeout
 * (only "Stopped" was observed at rest). Keep all the string matching here so
 * there is a single place to update once the live capture is done.
 */
export type BoardPhase = "idle" | "ready" | "takeout" | "throwing" | "unknown";

export function classifyStatus(status: string): BoardPhase {
  const s = status.toLowerCase();
  if (s.includes("takeout") || s.includes("take-out")) return "takeout";
  if (s.includes("stop") || s.includes("calibrat") || s.includes("disconnect")) return "idle";
  if (s.includes("throw")) return "throwing";
  if (s.includes("start") || s.includes("live") || s.includes("ready")) return "ready";
  return "unknown";
}

/** Normalize a single raw throw into a Dart at a 1-based index. */
export function toDart(raw: RawThrow, index: number): Dart {
  const { segment, coords } = raw;
  return {
    index,
    name: segment.name,
    number: segment.number,
    bed: segment.bed,
    multiplier: segment.multiplier,
    points: segment.number * segment.multiplier,
    coords:
      coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)
        ? { x: coords.x, y: coords.y }
        : null,
  };
}

/** Normalize all throws currently on the board. */
export function toDarts(state: RawBoardState): Dart[] {
  return (state.throws ?? []).map((t, i) => toDart(t, i + 1));
}

/**
 * Diff two consecutive board snapshots into FSM signals.
 *
 * Detection rules:
 *  - New darts: `throws` grew (or numThrows increased) -> one DART per new entry.
 *  - Takeout: status classifies as takeout, OR the throw count dropped from >0
 *    to 0 (the board cleared after a visit).
 *  - Board idle/ready transitions are emitted on status-phase change.
 */
export function boardStateToSignals(
  prev: RawBoardState | null,
  next: RawBoardState,
  now: number,
): Signal[] {
  const signals: Signal[] = [];
  const nextPhase = classifyStatus(next.status);

  if (!next.connected) {
    if (!prev || prev.connected) signals.push({ type: "BOARD_IDLE", at: now });
    return signals;
  }

  // First snapshot only establishes a baseline — don't replay darts already on
  // the board (e.g. leftovers at server start) as a phantom visit.
  if (!prev) return signals;

  const prevPhase = classifyStatus(prev.status);
  const prevThrows = prev?.throws ?? [];
  const nextThrows = next.throws ?? [];
  const prevCount = prevThrows.length;
  const nextCount = nextThrows.length;

  // New darts appended since last snapshot.
  if (nextCount > prevCount) {
    for (let i = prevCount; i < nextCount; i++) {
      signals.push({ type: "DART", dart: toDart(nextThrows[i], i + 1), at: now });
    }
  }

  // Two distinct moments:
  //  - TAKEOUT: the board enters "Takeout" status (right after the 3rd dart, or
  //    when a hand is detected) — darts are usually STILL in the board. This ends
  //    the visit and triggers the replay.
  //  - COLLECTED: the throws array clears (>0 -> 0) — darts physically removed.
  //    This is what starts the re-arm countdown.
  if (nextPhase === "takeout" && prevPhase !== "takeout") {
    signals.push({ type: "TAKEOUT", at: now });
  }
  if (prevCount > 0 && nextCount === 0) {
    signals.push({ type: "COLLECTED", at: now });
  }

  // Board went idle (stopped/calibration/disconnect).
  if (nextPhase === "idle" && prevPhase !== "idle") {
    signals.push({ type: "BOARD_IDLE", at: now });
  }

  return signals;
}
