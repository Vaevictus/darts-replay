// Build a per-visit MP4 by stream-copying the ring segments that overlap the
// visit window. No re-encode -> fast ("instant") finalize.

import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SegmentWindow } from "./ring-buffer.js";

export class ExtractError extends Error {}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new ExtractError(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

/**
 * Concatenate (stream-copy) the given segments into `outPath`.
 * @returns the output path on success.
 */
export async function extractClip(
  segments: SegmentWindow[],
  outPath: string,
  clipDir: string,
): Promise<string> {
  if (segments.length === 0) throw new ExtractError("no segments overlap the visit window");

  const listPath = join(clipDir, `${Date.now()}-${Math.floor(performance.now())}.concat.txt`);
  const list = segments.map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await writeFile(listPath, list, "utf8");

  try {
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      outPath,
    ]);
    return outPath;
  } finally {
    await unlink(listPath).catch(() => {});
  }
}
