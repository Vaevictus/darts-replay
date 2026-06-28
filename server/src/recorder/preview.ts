// Pause-and-stream live camera preview. The ring-buffer ffmpeg holds the V4L2
// device, and V4L2 won't allow a second capture of the same node — so while the
// preview is active we STOP the ring buffer (releasing the device), stream MJPEG
// straight from the camera for positioning, and resume recording when done.
//
// An idle watchdog guarantees recording always resumes: if the preview is active
// but no client is watching the stream for a while (e.g. the browser tab died),
// we auto-stop and re-arm the recorder.

import { spawn, type ChildProcess } from "node:child_process";
import type { ServerResponse } from "node:http";
import type { Config } from "@shared/types.js";
import type { RingBuffer } from "./ring-buffer.js";
import { orientationChain } from "./filters.js";
import { logger } from "../log.js";

/** A subset of webcam settings the preview may override per-stream, so the live
 * view can reflect unsaved Settings edits before they're persisted. */
export type WebcamOverride = Partial<
  Pick<Config["webcam"], "device" | "format" | "width" | "height" | "fps" | "rotation" | "flipH" | "flipV">
>;

const log = logger("preview");

// ffmpeg's mpjpeg muxer writes `--ffmpeg` part boundaries, so the multipart
// boundary parameter is "ffmpeg".
const BOUNDARY = "ffmpeg";
const PREVIEW_FPS = 15; // smooth enough for positioning, easy on CPU
const IDLE_MS = 30_000; // auto-resume recording if nobody is watching

export class CameraPreview {
  private getConfig: () => Config;
  private ring: RingBuffer;
  private previewing = false;
  private streamProc: ChildProcess | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(getConfig: () => Config, ring: RingBuffer) {
    this.getConfig = getConfig;
    this.ring = ring;
  }

  isPreviewing(): boolean {
    return this.previewing;
  }

  /** Enter preview mode: stop recording and release the camera. Idempotent. */
  async start(): Promise<void> {
    if (this.previewing) {
      this.armIdle();
      return;
    }
    await this.ring.stopAndWait();
    this.previewing = true;
    log.info("preview started — recording paused");
    this.armIdle();
  }

  /** Leave preview mode: kill any stream and resume recording. Idempotent. */
  stop(): void {
    if (!this.previewing) return;
    this.previewing = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.killStream();
    this.ring.start();
    log.info("preview stopped — recording resumed");
  }

  /** Tear down for shutdown: kill the stream and stop the watchdog without
   * resuming the recorder (the caller stops the ring buffer itself). */
  dispose(): void {
    this.previewing = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.killStream();
  }

  /** Pipe a live multipart-MJPEG stream to the HTTP response. Ensures preview
   * mode, replacing any existing stream (e.g. when the client reconnects after a
   * resolution/orientation change). */
  async stream(res: ServerResponse, override: WebcamOverride = {}): Promise<void> {
    await this.start();
    this.killStream();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const proc = spawn("ffmpeg", this.streamArgs(override), { stdio: ["ignore", "pipe", "pipe"] });
    this.streamProc = proc;

    let stderr = "";
    proc.stderr?.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-2000);
    });

    res.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Connection: "close",
    });
    proc.stdout?.pipe(res);

    const cleanup = () => {
      if (this.streamProc === proc) this.streamProc = null;
      proc.stdout?.unpipe(res);
      if (!proc.killed) proc.kill("SIGKILL");
      // Re-arm the idle watchdog so recording resumes if no new stream connects.
      if (this.previewing) this.armIdle();
    };

    res.on("close", cleanup);
    proc.on("error", (err) => {
      log.error(`preview ffmpeg failed to spawn: ${err.message}`);
      try {
        res.end();
      } catch {
        /* response already torn down */
      }
      cleanup();
    });
    proc.on("exit", (code) => {
      // 255 = SIGKILL from our own cleanup; not worth logging.
      if (code && code !== 255) log.error(`preview ffmpeg exited (${code}).${stderr ? ` tail:\n${stderr}` : ""}`);
      try {
        res.end();
      } catch {
        /* response already torn down */
      }
      cleanup();
    });
  }

  private streamArgs(override: WebcamOverride): string[] {
    const webcam = { ...this.getConfig().webcam, ...override };
    const chain = orientationChain(webcam);
    return [
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
      ...(chain.length ? ["-vf", chain.join(",")] : []),
      "-r",
      String(PREVIEW_FPS),
      "-f",
      "mpjpeg",
      "-q:v",
      "6",
      "-",
    ];
  }

  private killStream(): void {
    const p = this.streamProc;
    this.streamProc = null;
    if (p && !p.killed) p.kill("SIGKILL");
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.previewing && !this.streamProc) {
        log.warn("preview idle — no client watching; resuming recording");
        this.stop();
      }
    }, IDLE_MS);
  }
}
