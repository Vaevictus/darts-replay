// Enumerate V4L2 cameras and their capabilities for the Settings UI. Uses
// `v4l2-ctl` (capability queries only — they don't open the device for capture,
// so they're safe to run while the ring buffer is recording). Falls back to a
// /dev/video* glob when v4l2-ctl is absent; the UI then degrades to free-text.
//
// The text parsers are pure and exported so they can be unit-tested without a
// camera attached.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { logger } from "./log.js";

const log = logger("cameras");

export interface CameraSize {
  w: number;
  h: number;
  fps: number[]; // discrete framerates, highest first
}
export interface CameraFormat {
  fourcc: string; // e.g. "MJPG"
  label: string; // e.g. "Motion-JPEG, compressed"
  normalized: "h264" | "mjpeg" | "yuyv422" | null; // maps to Config.webcam.format
  sizes: CameraSize[];
}
export interface Camera {
  path: string; // /dev/videoN
  name: string;
  caps: CameraFormat[];
}

const FOURCC_MAP: Record<string, CameraFormat["normalized"]> = {
  MJPG: "mjpeg",
  YUYV: "yuyv422",
  H264: "h264",
};

/** Parse `v4l2-ctl --list-devices` into name -> /dev/video* nodes. */
export function parseDevices(text: string): { name: string; nodes: string[] }[] {
  const out: { name: string; nodes: string[] }[] = [];
  let current: { name: string; nodes: string[] } | null = null;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    if (!/^\s/.test(raw)) {
      // Unindented line: a device header like "HD Web Camera (usb-...):"
      current = { name: raw.replace(/:\s*$/, "").trim(), nodes: [] };
      out.push(current);
    } else if (current) {
      const node = raw.trim();
      if (/^\/dev\/video\d+$/.test(node)) current.nodes.push(node);
    }
  }
  return out;
}

/** Parse `v4l2-ctl --list-formats-ext` into the supported formats/sizes/fps. */
export function parseFormats(text: string): CameraFormat[] {
  const formats: CameraFormat[] = [];
  let fmt: CameraFormat | null = null;
  let size: CameraSize | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const fm = /^\[\d+\]:\s*'(\w+)'\s*\(([^)]*)\)/.exec(line);
    if (fm) {
      fmt = { fourcc: fm[1], label: fm[2].trim(), normalized: FOURCC_MAP[fm[1]] ?? null, sizes: [] };
      formats.push(fmt);
      size = null;
      continue;
    }
    const sm = /^Size:\s*Discrete\s*(\d+)x(\d+)/.exec(line);
    if (sm && fmt) {
      size = { w: Number(sm[1]), h: Number(sm[2]), fps: [] };
      fmt.sizes.push(size);
      continue;
    }
    const im = /\(([\d.]+)\s*fps\)/.exec(line);
    if (im && size) {
      const fps = Math.round(Number(im[1]));
      if (!size.fps.includes(fps)) size.fps.push(fps);
      size.fps.sort((a, b) => b - a);
    }
  }
  return formats;
}

function run(args: string[]): string | null {
  const r = spawnSync("v4l2-ctl", args, { encoding: "utf8", timeout: 3000 });
  if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout;
}

/** /dev/video* fallback when v4l2-ctl is unavailable. */
function globVideoNodes(): string[] {
  try {
    return readdirSync("/dev")
      .filter((n) => /^video\d+$/.test(n))
      .map((n) => `/dev/${n}`)
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  } catch {
    return [];
  }
}

/**
 * List cameras with capabilities. Returns one entry per /dev/video* node that
 * reports at least one format, preserving v4l2-ctl's device ordering and names.
 */
export function listCameras(): Camera[] {
  const listing = run(["--list-devices"]);
  if (listing === null) {
    log.warn("v4l2-ctl unavailable — camera capability detection limited to a /dev/video* list.");
    return globVideoNodes().map((path) => ({ path, name: path, caps: [] }));
  }

  const groups = parseDevices(listing);
  const nameByNode = new Map<string, string>();
  const ordered: string[] = [];
  for (const g of groups) {
    for (const node of g.nodes) {
      if (!nameByNode.has(node)) {
        nameByNode.set(node, g.name);
        ordered.push(node);
      }
    }
  }
  // Include any nodes v4l2-ctl didn't group (rare) so nothing is hidden.
  for (const node of globVideoNodes()) {
    if (!nameByNode.has(node)) {
      nameByNode.set(node, node);
      ordered.push(node);
    }
  }

  const cameras: Camera[] = [];
  for (const path of ordered) {
    const fmtText = run(["-d", path, "--list-formats-ext"]);
    const caps = fmtText ? parseFormats(fmtText) : [];
    // Skip pure metadata/output nodes that expose no capture formats.
    if (caps.length === 0) continue;
    cameras.push({ path, name: nameByNode.get(path) ?? path, caps });
  }
  // If every node looked capture-less, fall back to showing them all.
  if (cameras.length === 0) {
    return ordered.map((path) => ({ path, name: nameByNode.get(path) ?? path, caps: [] }));
  }
  return cameras;
}
