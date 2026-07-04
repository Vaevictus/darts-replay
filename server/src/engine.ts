// The orchestrator: feeds board signals into the visit FSM, carries out the
// effects (timers, clip extraction), and emits messages for connected clients.

import {
  step,
  initialState,
  fsmConfig,
  type MachineState,
  type Signal,
  type Effect,
  type TimerName,
} from "@shared/state-machine.js";
import type { Config, RawBoardState } from "@shared/types.js";
import type { ServerMessage } from "@shared/messages.js";
import type { ServerResponse } from "node:http";
import { BoardAdapter } from "./board/adapter.js";
import { RingBuffer } from "./recorder/ring-buffer.js";
import { CameraPreview, type WebcamOverride } from "./recorder/preview.js";
import { extractClip } from "./recorder/extract.js";
import { VisitStore } from "./store/visits.js";
import { clipsDir } from "./config.js";
import { logger } from "./log.js";

const log = logger("engine");

export type { ServerMessage };

export class Engine {
  private cfg: Config;
  private state: MachineState = initialState();
  private timers = new Map<TimerName, NodeJS.Timeout>();
  private adapter: BoardAdapter;
  private ring: RingBuffer;
  private preview: CameraPreview;
  private store: VisitStore;
  private broadcast: (msg: ServerMessage) => void;
  private lastBoardStatus = "Unknown";

  constructor(cfg: Config, store: VisitStore, broadcast: (msg: ServerMessage) => void) {
    this.cfg = cfg;
    this.store = store;
    this.broadcast = broadcast;
    // Continue visit numbering across restarts (persisted visits keep their seq).
    this.state = { ...this.state, seq: store.maxSeq() };
    this.ring = new RingBuffer(cfg);
    this.preview = new CameraPreview(() => this.cfg, this.ring);
    this.adapter = this.makeAdapter();
  }

  private makeAdapter(): BoardAdapter {
    return new BoardAdapter({
      host: this.cfg.board.host,
      port: this.cfg.board.port,
      pollIntervalMs: this.cfg.board.pollIntervalMs,
      onSignal: (sig) => this.handle(sig),
      onState: (s) => this.onBoardState(s),
    });
  }

  start(): void {
    this.ring.start();
    this.adapter.start();
  }

  stop(): void {
    this.adapter.stop();
    this.preview.dispose();
    this.ring.stop();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /**
   * Apply config changes. Visit timeouts take effect immediately. Capture-affecting
   * changes (camera device/format/orientation, segment dirs) hot-restart the ring
   * buffer; board host/port/poll changes reconnect the adapter — no process restart.
   */
  updateConfig(cfg: Config): void {
    const prev = this.cfg;
    this.cfg = cfg;
    this.ring.setConfig(cfg);

    if (this.captureChanged(prev, cfg) && !this.preview.isPreviewing()) {
      void this.ring.restart().catch((err) => log.error("capture restart failed:", err));
    }
    if (JSON.stringify(prev.board) !== JSON.stringify(cfg.board)) {
      this.adapter.stop();
      this.adapter = this.makeAdapter();
      this.adapter.start();
    }
  }

  /** True if a webcam/recorder field that feeds the capture ffmpeg command changed. */
  private captureChanged(a: Config, b: Config): boolean {
    if (JSON.stringify(a.webcam) !== JSON.stringify(b.webcam)) return true;
    return (
      a.recorder.segmentDir !== b.recorder.segmentDir ||
      a.recorder.segmentSeconds !== b.recorder.segmentSeconds
    );
  }

  /** Enter live-preview mode (pauses recording). */
  startPreview(): Promise<void> {
    return this.preview.start();
  }

  /** Leave live-preview mode (resumes recording). */
  stopPreview(): void {
    this.preview.stop();
  }

  /** Stream multipart MJPEG of the live camera to an HTTP response. The optional
   * override lets the live view reflect unsaved Settings edits. */
  streamPreview(res: ServerResponse, override?: WebcamOverride): Promise<void> {
    return this.preview.stream(res, override);
  }

  getState() {
    return {
      phase: this.state.phase,
      dartsCount: this.state.darts.length,
      board: this.lastBoardStatus,
      darts: this.state.darts,
      ringHealthy: this.ring.healthy(),
      ringBytes: this.ring.sizeBytes(),
      previewing: this.preview.isPreviewing(),
    };
  }

  /** Push an existing visit's clip to clients to play (manual review). */
  replay(visitId: string): boolean {
    const v = this.store.get(visitId);
    if (!v?.clipUrl) return false;
    this.broadcast({ type: "play", visitId });
    return true;
  }

  private onBoardState(s: RawBoardState): void {
    if (s.status !== this.lastBoardStatus) {
      this.lastBoardStatus = s.status;
      this.emitState();
    }
  }

  private emitState(): void {
    this.broadcast({
      type: "state",
      phase: this.state.phase,
      dartsCount: this.state.darts.length,
      board: this.lastBoardStatus,
      darts: this.state.darts,
    });
  }

  private handle(signal: Signal): void {
    const prevPhase = this.state.phase;
    const { state, effects } = step(this.state, signal, fsmConfig(this.cfg));
    this.state = state;
    for (const eff of effects) this.applyEffect(eff);
    if (state.phase !== prevPhase || signal.type === "DART") this.emitState();
  }

  private applyEffect(eff: Effect): void {
    switch (eff.type) {
      case "START_TIMER": {
        this.setTimer(eff.name, eff.ms);
        break;
      }
      case "CANCEL_TIMER": {
        const t = this.timers.get(eff.name);
        if (t) clearTimeout(t);
        this.timers.delete(eff.name);
        break;
      }
      case "VISIT_READY": {
        this.store.add(eff.visit).catch((err) => log.error(`failed to persist visit ${eff.visit.id}:`, err));
        this.broadcast({ type: "visit", visit: eff.visit });
        break;
      }
      case "EXTRACT_CLIP": {
        void this.produceClip(eff.visitId, eff.startMs, eff.endMs);
        break;
      }
    }
  }

  private setTimer(name: TimerName, ms: number): void {
    const existing = this.timers.get(name);
    if (existing) clearTimeout(existing);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        this.handle({ type: "TIMER", name, at: Date.now() });
      }, ms),
    );
  }

  private async produceClip(visitId: string, startMs: number, endMs: number): Promise<void> {
    try {
      const waitMs = Math.max(0, endMs - Date.now());
      await new Promise((r) => setTimeout(r, waitMs));
      await this.ring.waitForWindowFlushed(endMs);
      const segs = this.ring.segmentsForWindow(startMs, endMs);
      const out = this.store.clipPath(visitId);
      await extractClip(segs, out, clipsDir(this.cfg));
      // The clip's t=0 is the first included segment's start, so impacts can be
      // synced to playback time as (dart.at - clipStartMs).
      const updated = await this.store.update(visitId, {
        clipUrl: `/clips/${visitId}.mp4`,
        clipStartMs: segs[0]?.start,
      });
      if (updated) this.broadcast({ type: "visit-ready", visit: updated });
    } catch (err) {
      log.error(`clip extraction failed for ${visitId}:`, err);
    }
  }
}
