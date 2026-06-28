// Always-on capture of the spare webcam into a ring of 1-second TS segments on
// tmpfs. ffmpeg stamps each segment's *start* wall-clock into its filename via
// -strftime, so segment timing is exact and immune to fs-watch latency (an
// earlier fs.watch-based approach mis-timed segments under encoding load and
// produced clips referencing wrong/pruned segments). A visit clip is a
// stream-copy concat of the segments overlapping the visit window.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "@shared/types.js";
import { logger } from "../log.js";

const log = logger("ring");

export interface SegmentWindow {
  path: string;
  start: number; // epoch ms the segment started (from its filename)
  end: number; // start of the next segment, or now for the open one
}

// seg_<epoch-seconds>.ts
const SEG_RE = /^seg_(\d+)\.ts$/;

export class RingBuffer {
  private cfg: Config;
  private proc: ChildProcess | null = null;
  private prune: NodeJS.Timeout | null = null;
  private stopped = false;
  private now: () => number;

  constructor(cfg: Config, now: () => number = Date.now) {
    this.cfg = cfg;
    this.now = now;
  }

  start(): void {
    this.stopped = false;
    mkdirSync(this.cfg.recorder.segmentDir, { recursive: true });
    mkdirSync(this.cfg.recorder.clipDir, { recursive: true });
    this.spawnFfmpeg();
    this.prune = setInterval(() => this.pruneOld(), 2000);
  }

  stop(): void {
    this.stopped = true;
    if (this.prune) clearInterval(this.prune);
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      // Let ffmpeg flush/close the current segment, then force-kill if it lingers.
      proc.kill("SIGTERM");
      const t = setTimeout(() => proc.kill("SIGKILL"), 1500);
      proc.once("exit", () => clearTimeout(t));
    }
  }

  private pruneOld(): void {
    const cutoff = this.now() - this.cfg.recorder.ringSeconds * 1000;
    for (const seg of this.segments()) {
      if (seg.end < cutoff) {
        try {
          rmSync(seg.path, { force: true });
        } catch {
          // Race: another sweep or an extract may have removed it already.
        }
      }
    }
  }

  private ffmpegArgs(): string[] {
    const { webcam, recorder } = this.cfg;
    const input = [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "v4l2",
      "-input_format",
      webcam.format,
      "-video_size",
      `${webcam.width}x${webcam.height}`,
      "-framerate",
      String(webcam.fps),
      "-i",
      webcam.device,
    ];
    let codec: string[];
    if (webcam.encoder === "copy") {
      codec = ["-c", "copy"];
    } else if (webcam.encoder === "vaapi") {
      codec = [
        "-vaapi_device",
        "/dev/dri/renderD128",
        "-vf",
        "format=nv12,hwupload",
        "-c:v",
        "h264_vaapi",
        "-g",
        String(webcam.fps),
      ];
    } else {
      codec = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(webcam.fps)];
    }
    const output = [
      "-f",
      "segment",
      "-segment_time",
      String(recorder.segmentSeconds),
      "-reset_timestamps",
      "1",
      "-segment_format",
      "mpegts",
      // ffmpeg writes the segment's start wall-clock (epoch seconds) into the name.
      "-strftime",
      "1",
      join(recorder.segmentDir, "seg_%s.ts"),
    ];
    return [...input, ...codec, ...output];
  }

  private spawnFfmpeg(): void {
    if (this.stopped) return;
    const proc = spawn("ffmpeg", this.ffmpegArgs(), { stdio: ["ignore", "ignore", "pipe"] });
    this.proc = proc;
    let stderr = "";
    let restarted = false;
    const restart = (reason: string) => {
      if (this.stopped || restarted) return;
      restarted = true;
      log.error(`ffmpeg ${reason}; restarting in 2s.${stderr ? ` tail:\n${stderr}` : ""}`);
      setTimeout(() => this.spawnFfmpeg(), 2000);
    };
    proc.stderr?.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-2000);
    });
    proc.on("error", (err) => restart(`failed to spawn (${err.message})`));
    proc.on("exit", (code) => restart(`exited (${code})`));
  }

  /** Segments sorted by start, each with a computed end (next.start or now). */
  segments(): SegmentWindow[] {
    let names: string[];
    try {
      names = readdirSync(this.cfg.recorder.segmentDir);
    } catch {
      return []; // dir not created yet, or briefly absent during restart
    }
    const segs: { path: string; start: number }[] = [];
    for (const name of names) {
      const m = SEG_RE.exec(name);
      if (!m) continue;
      segs.push({ path: join(this.cfg.recorder.segmentDir, name), start: Number(m[1]) * 1000 });
    }
    segs.sort((a, b) => a.start - b.start);
    return segs.map((s, i) => ({
      ...s,
      end: i + 1 < segs.length ? segs[i + 1].start : this.now(),
    }));
  }

  /** Segments overlapping [startMs, endMs] that still exist on disk. */
  segmentsForWindow(startMs: number, endMs: number): SegmentWindow[] {
    return this.segments().filter((s) => s.start < endMs && s.end > startMs && existsSync(s.path));
  }

  /**
   * Resolve once the window is fully flushed — a segment starting after endMs
   * exists (so the segment covering endMs is closed). Falls back after timeout.
   */
  waitForWindowFlushed(endMs: number, timeoutMs = 4000): Promise<void> {
    const startWait = this.now();
    return new Promise((resolve) => {
      const check = () => {
        const flushed = this.segments().some((s) => s.start > endMs);
        if (flushed || this.now() - startWait > timeoutMs) return resolve();
        setTimeout(check, 150);
      };
      check();
    });
  }

  /** True if capture is currently producing fresh segments. */
  healthy(): boolean {
    const segs = this.segments();
    if (segs.length === 0) return false;
    return this.now() - segs[segs.length - 1].start < this.cfg.recorder.segmentSeconds * 1000 + 4000;
  }

  sizeBytes(): number {
    let total = 0;
    for (const seg of this.segments()) {
      try {
        total += statSync(seg.path).size;
      } catch {
        // Segment pruned between listing and stat — skip it.
      }
    }
    return total;
  }
}
