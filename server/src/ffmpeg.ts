// Shared ffmpeg/ffprobe helpers.

import { spawn } from "node:child_process";

export class FfmpegError extends Error {}

/** Run ffmpeg, resolving on exit 0 and rejecting with the stderr tail otherwise. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new FfmpegError(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

/** Probe a video file's native pixel dimensions via ffprobe. */
export function probeDims(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (b) => (stdout += b.toString()));
    proc.stderr?.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) return reject(new FfmpegError(`ffprobe exited ${code}: ${stderr.slice(-400)}`));
      try {
        const s = (JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
        if (!s?.width || !s?.height) return reject(new FfmpegError("ffprobe returned no dimensions"));
        resolve({ width: s.width, height: s.height });
      } catch (err) {
        reject(err instanceof Error ? err : new FfmpegError("ffprobe parse failed"));
      }
    });
  });
}
