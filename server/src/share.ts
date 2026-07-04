// Build a shareable clip: burn the chosen overlays (calibrated board, guide wires,
// caption) into a re-encoded H.264 MP4, optionally stitch several, optionally
// upload to a host. Overlays are generated server-side as one SVG (the board uses
// the shared, DOM-free buildBoardSvg) and rasterized with resvg — the box has no
// SVG rasterizer otherwise.

import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { buildBoardSvg } from "@shared/dartboard.js";
import type { Config, OverlayConfig, ShareOptions, ShareResult, ShareLink, Visit } from "@shared/types.js";
import { runFfmpeg, probeDims } from "./ffmpeg.js";
import { fetchWithTimeout } from "./fetch.js";
import { logger } from "./log.js";

const log = logger("share");
type BoardCal = Config["calibration"]["board"];

// Uploads can be large on a slow uplink; generous ceiling so a wedged upload
// can't hang the /api/share request (and the UI's "Encoding…" state) forever.
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

const GUIDE_COLOR = "#2bd576"; // overlay accent green

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/**
 * Compose the burn-in overlay for one clip as a W×H SVG. Pure and DOM-free
 * (unit-tested). Mirrors the on-screen overlays: the board is placed at the
 * calibrated centre/scale/rotation, guides are full-frame lines, caption sits
 * bottom-left.
 */
export function buildOverlaySvg(
  W: number,
  H: number,
  visit: Visit,
  cal: BoardCal,
  guides: OverlayConfig,
  opts: ShareOptions,
): string {
  const parts: string[] = [];

  if (opts.burnBoard) {
    const board = buildBoardSvg(opts.burnDarts ? visit.darts : [], { showNumbers: true });
    const boardPx = cal.scale * H;
    const cx = cal.x * W;
    const cy = cal.y * H;
    // Embed the board's own viewBox-scaled SVG into a positioned, rotated, faded box.
    const nested = board.replace(
      /^<svg /,
      `<svg x="${cx - boardPx / 2}" y="${cy - boardPx / 2}" width="${boardPx}" height="${boardPx}" opacity="${cal.opacity}" `,
    );
    parts.push(`<g transform="rotate(${cal.rotation} ${cx} ${cy})">${nested}</g>`);
  }

  if (opts.burnGuides && guides.enabled) {
    const sw = Math.max(2, Math.round(H * 0.004));
    for (const fx of guides.vertical) {
      const x = fx * W;
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${GUIDE_COLOR}" stroke-opacity="0.85" stroke-width="${sw}"/>`);
    }
    for (const fy of guides.horizontal) {
      const y = fy * H;
      parts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${GUIDE_COLOR}" stroke-opacity="0.85" stroke-width="${sw}"/>`);
    }
  }

  if (opts.burnCaption) {
    const text = `#${visit.seq} · ${visit.totalPoints} · darts-replay`;
    const fs = Math.max(14, Math.round(H * 0.03));
    const pad = Math.round(fs * 0.4);
    const boxH = fs + pad * 2;
    const boxW = Math.round(text.length * fs * 0.56) + pad * 2;
    parts.push(`<rect x="0" y="${H - boxH}" width="${boxW}" height="${boxH}" fill="#000000" fill-opacity="0.45"/>`);
    parts.push(
      `<text x="${pad}" y="${H - pad - Math.round(fs * 0.2)}" font-family="sans-serif" font-size="${fs}" fill="#ffffff">${escapeXml(text)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

function rasterize(svg: string): Buffer {
  const r = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  });
  return Buffer.from(r.render().asPng());
}

/** Burn a full-frame overlay PNG into a clip and re-encode H.264 (Reddit-friendly). */
function burnClip(clipPath: string, pngPath: string, outPath: string): Promise<void> {
  return runFfmpeg([
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-i", clipPath,
    "-i", pngPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-movflags", "+faststart", "-an",
    "-y", outPath,
  ]);
}

/** Concatenate already-burned parts (same camera ⇒ same params) into one file. */
function stitch(parts: string[], outPath: string): Promise<void> {
  const inputs = parts.flatMap((p) => ["-i", p]);
  const streams = parts.map((_, i) => `[${i}:v:0]`).join("");
  return runFfmpeg([
    "-nostdin", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", `${streams}concat=n=${parts.length}:v=1:a=0[v]`,
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-movflags", "+faststart", "-an",
    "-y", outPath,
  ]);
}

async function uploadCatbox(path: string): Promise<string> {
  const fd = new FormData();
  fd.append("reqtype", "fileupload");
  fd.append("fileToUpload", new Blob([await readFile(path)], { type: "video/mp4" }), basename(path));
  const res = await fetchWithTimeout("https://catbox.moe/user/api.php", UPLOAD_TIMEOUT_MS, { method: "POST", body: fd });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) throw new Error(`catbox failed: ${text.slice(0, 200) || res.status}`);
  return text;
}

async function uploadStreamable(path: string, creds: { email: string; password: string }): Promise<string> {
  if (!creds.email || !creds.password) throw new Error("Streamable email/password not set in Settings → Sharing");
  const fd = new FormData();
  fd.append("file", new Blob([await readFile(path)], { type: "video/mp4" }), basename(path));
  const auth = Buffer.from(`${creds.email}:${creds.password}`).toString("base64");
  const res = await fetchWithTimeout("https://api.streamable.com/upload", UPLOAD_TIMEOUT_MS, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "User-Agent": "darts-replay" },
    body: fd,
  });
  const body = (await res.json().catch(() => ({}))) as { shortcode?: string; error?: string };
  if (!res.ok || !body.shortcode) throw new Error(`Streamable failed: ${body.error ?? res.status}`);
  return `https://streamable.com/${body.shortcode}`;
}

export interface ShareInput {
  visits: Visit[]; // selected, in display order
  clipPathFor: (id: string) => string;
  shareDir: string;
  cal: BoardCal;
  guides: OverlayConfig;
  options: ShareOptions;
  streamable: { email: string; password: string };
}

/** Produce the share file(s) and optionally upload. */
export async function shareVisits(input: ShareInput): Promise<ShareResult> {
  const { visits, clipPathFor, shareDir, cal, guides, options, streamable } = input;
  await mkdir(shareDir, { recursive: true });
  const stamp = Date.now();
  const stitching = options.multi === "stitch" && visits.length > 1;

  const overlays: string[] = []; // temp PNGs — always removed
  const parts: string[] = []; // stitch intermediates — always removed (never a deliverable)
  const outputs: string[] = []; // separate-mode deliverables — removed only on failure
  let finalOut: string | null = null; // stitched deliverable
  let ok = false;
  try {
    for (const [i, v] of visits.entries()) {
      const clip = clipPathFor(v.id);
      const { width, height } = await probeDims(clip);
      const pngPath = join(shareDir, `.ov_${stamp}_${i}.png`);
      overlays.push(pngPath);
      await writeFile(pngPath, rasterize(buildOverlaySvg(width, height, v, cal, guides, options)));
      const out = join(shareDir, stitching ? `.part_${stamp}_${i}.mp4` : `share_${v.id}_${stamp}.mp4`);
      (stitching ? parts : outputs).push(out);
      await burnClip(clip, pngPath, out);
    }

    let files: string[];
    if (stitching) {
      finalOut = join(shareDir, `share_${stamp}.mp4`);
      await stitch(parts, finalOut);
      files = [finalOut];
    } else {
      files = outputs;
    }

    const links: ShareLink[] = [];
    if (options.host !== "none") {
      for (const f of files) {
        try {
          const url = options.host === "catbox" ? await uploadCatbox(f) : await uploadStreamable(f, streamable);
          links.push({ host: options.host, url });
        } catch (err) {
          log.error(`upload to ${options.host} failed:`, err);
          links.push({ host: options.host, url: "", error: err instanceof Error ? err.message : "upload failed" });
        }
      }
    }

    ok = true;
    return { files: files.map((f) => `/share/${basename(f)}`), links };
  } finally {
    // Overlay PNGs and stitch parts are never deliverables — always clean them.
    // On failure, also remove any partial deliverables we produced.
    for (const p of [...overlays, ...parts]) await unlink(p).catch(() => {});
    if (!ok) {
      for (const p of outputs) await unlink(p).catch(() => {});
      if (finalOut) await unlink(finalOut).catch(() => {});
    }
  }
}
