// Startup environment checks. Turns cryptic runtime failures (ffmpeg respawn
// loops, missing camera) into clear, actionable messages on boot.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Config } from "@shared/types.js";
import { logger } from "./log.js";

const log = logger("preflight");

export class PreflightError extends Error {}

/**
 * Verify the host can run the recorder. Throws PreflightError for hard blockers
 * (no ffmpeg), warns for likely-misconfigured-but-recoverable issues (wrong
 * platform, missing camera — the board/camera may simply be plugged in later).
 */
export function preflight(config: Config): void {
  if (process.platform !== "linux") {
    log.warn(
      `darts-replay targets Linux (V4L2 capture, /dev/shm). Detected '${process.platform}' — the recorder will likely fail.`,
    );
  }

  // ffmpeg is required and its absence otherwise causes a silent respawn loop.
  const ff = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (ff.error || ff.status !== 0) {
    throw new PreflightError(
      "ffmpeg not found on PATH. Install it (e.g. `sudo apt install ffmpeg`) and retry.",
    );
  }

  // Camera may legitimately be absent at boot; warn rather than fail.
  if (!existsSync(config.webcam.device)) {
    log.warn(
      `webcam device ${config.webcam.device} not found. Set webcam.device in config.json ` +
        `(list devices with \`v4l2-ctl --list-devices\`). Recording will retry until it appears.`,
    );
  }

  if (config.webcam.encoder === "vaapi" && !existsSync("/dev/dri/renderD128")) {
    log.warn("encoder is 'vaapi' but /dev/dri/renderD128 is missing — capture will fail; use 'x264'.");
  }

  log.info("preflight checks passed");
}
