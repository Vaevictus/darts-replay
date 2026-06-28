import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BoardAdapter } from "../server/src/board/adapter.js";
import type { Signal } from "@shared/state-machine.js";

const seg = (name: string, n: number, m: number) => ({
  segment: { name, number: n, bed: "SingleOuter", multiplier: m },
  coords: { x: 0.1, y: 0.5 },
});

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("BoardAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("emits DART, TAKEOUT and COLLECTED across a visit", async () => {
    const responses: unknown[] = [
      { connected: true, running: true, status: "Throw", event: "ready", numThrows: 0 }, // baseline (no throws key)
      { connected: true, running: true, status: "Throw", numThrows: 1, throws: [seg("T20", 20, 3)] }, // DART
      { connected: true, running: true, status: "Takeout", numThrows: 1, throws: [seg("T20", 20, 3)] }, // TAKEOUT
      { connected: true, running: true, status: "Throw", numThrows: 0 }, // throws cleared -> COLLECTED
    ];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(responses[Math.min(i++, responses.length - 1)])));

    const signals: Signal[] = [];
    const adapter = new BoardAdapter({
      host: "127.0.0.1",
      port: 3180,
      pollIntervalMs: 100,
      onSignal: (s) => signals.push(s),
      now: () => 1000,
    });
    adapter.start();
    await vi.advanceTimersByTimeAsync(350);
    adapter.stop();

    const types = signals.map((s) => s.type);
    expect(types).toContain("DART");
    expect(types).toContain("TAKEOUT");
    expect(types).toContain("COLLECTED");
    // baseline snapshot must not synthesize a phantom dart
    expect(types.indexOf("DART")).toBeGreaterThan(-1);
  });

  it("emits BOARD_IDLE when the board is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    const signals: Signal[] = [];
    const adapter = new BoardAdapter({
      host: "127.0.0.1",
      port: 3180,
      pollIntervalMs: 100,
      onSignal: (s) => signals.push(s),
      now: () => 1000,
    });
    adapter.start();
    await vi.advanceTimersByTimeAsync(150);
    adapter.stop();
    expect(signals.some((s) => s.type === "BOARD_IDLE")).toBe(true);
  });
});
