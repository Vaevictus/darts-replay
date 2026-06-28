// Board adapter: polls the autodarts board manager /api/state and turns the
// stream of snapshots into FSM signals. socket.io is not actually served by the
// board manager, so polling is the supported real-time mechanism.

import { boardStateToSignals } from "@shared/board.js";
import type { RawBoardState } from "@shared/types.js";
import type { Signal } from "@shared/state-machine.js";

const DISCONNECTED: RawBoardState = {
  connected: false,
  running: false,
  status: "Disconnected",
  event: "Disconnected",
  numThrows: 0,
  throws: [],
};

export interface BoardAdapterOptions {
  host: string;
  port: number;
  pollIntervalMs: number;
  onSignal: (signal: Signal) => void;
  onState?: (state: RawBoardState) => void;
  now?: () => number;
}

export class BoardAdapter {
  private opts: BoardAdapterOptions;
  private prev: RawBoardState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private url: string;
  private now: () => number;

  constructor(opts: BoardAdapterOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.url = `http://${opts.host}:${opts.port}/api/state`;
  }

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async fetchState(): Promise<RawBoardState> {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), Math.max(1000, this.opts.pollIntervalMs * 4));
    try {
      const res = await fetch(this.url, { signal: ac.signal });
      if (!res.ok) return DISCONNECTED;
      const body = (await res.json()) as RawBoardState;
      // The board omits `throws` entirely when there are 0 darts — that is a
      // valid state, not a disconnect. Only `status` must be present.
      if (typeof body?.status !== "string") return DISCONNECTED;
      return { ...body, throws: Array.isArray(body.throws) ? body.throws : [] };
    } catch {
      return DISCONNECTED;
    } finally {
      clearTimeout(to);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const next = await this.fetchState();
    const now = this.now();
    for (const sig of boardStateToSignals(this.prev, next, now)) this.opts.onSignal(sig);
    this.opts.onState?.(next);
    this.prev = next;
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.opts.pollIntervalMs);
  }
}
