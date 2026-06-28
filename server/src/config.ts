import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Config } from "@shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repo root (server/src/ -> ../../). */
export const ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = resolve(ROOT, "config.json");

export const DEFAULT_CONFIG: Config = {
  board: { host: "127.0.0.1", port: 3180, pollIntervalMs: 150 },
  webcam: { device: "/dev/video6", width: 1280, height: 720, fps: 30, format: "mjpeg", encoder: "x264" },
  recorder: {
    segmentDir: "/dev/shm/darts-replay/ring",
    clipDir: "var/clips",
    segmentSeconds: 1,
    ringSeconds: 90,
    preRollMs: 1200,
    postRollMs: 1200,
  },
  visit: { inactivityTimeoutMs: 12000, thirdDartGraceMs: 600, collectTimeoutMs: 4000 },
  retainCount: 12,
  server: { port: 8787 },
};

/** A patch that may override whole sections or individual nested fields. */
export type ConfigPatch = {
  [K in keyof Config]?: Config[K] extends object ? Partial<Config[K]> : Config[K];
};

/** Merge a partial config over a base, section by section (one level of nesting). */
export function merge(base: Config, over: ConfigPatch): Config {
  return {
    board: { ...base.board, ...over.board },
    webcam: { ...base.webcam, ...over.webcam },
    recorder: { ...base.recorder, ...over.recorder },
    visit: { ...base.visit, ...over.visit },
    retainCount: over.retainCount ?? base.retainCount,
    server: { ...base.server, ...over.server },
  };
}

const WEBCAM_FORMATS = ["h264", "mjpeg", "yuyv422"] as const;
const ENCODERS = ["copy", "x264", "vaapi"] as const;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate an untrusted config patch (e.g. a PUT body). Returns the subset of
 * recognized, well-typed fields and a list of human-readable errors. Unknown
 * keys are ignored; the caller rejects the request when `errors` is non-empty.
 */
export function validateConfigPatch(input: unknown): { patch: ConfigPatch; errors: string[] } {
  const errors: string[] = [];
  const patch: ConfigPatch = {};
  if (!isObj(input)) return { patch, errors: ["body must be an object"] };

  const num = (sec: string, k: string, v: unknown, { min, max, int }: { min?: number; max?: number; int?: boolean }) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return void errors.push(`${sec}.${k} must be a finite number`);
    if (int && !Number.isInteger(v)) return void errors.push(`${sec}.${k} must be an integer`);
    if (min !== undefined && v < min) return void errors.push(`${sec}.${k} must be >= ${min}`);
    if (max !== undefined && v > max) return void errors.push(`${sec}.${k} must be <= ${max}`);
    return v;
  };
  const str = (sec: string, k: string, v: unknown) =>
    typeof v === "string" && v.length > 0 ? v : void errors.push(`${sec}.${k} must be a non-empty string`);

  if (isObj(input.board)) {
    const b = input.board, out: Partial<Config["board"]> = {};
    if ("host" in b) { const r = str("board", "host", b.host); if (r !== undefined) out.host = r; }
    if ("port" in b) { const r = num("board", "port", b.port, { min: 1, max: 65535, int: true }); if (r !== undefined) out.port = r; }
    if ("pollIntervalMs" in b) { const r = num("board", "pollIntervalMs", b.pollIntervalMs, { min: 20, int: true }); if (r !== undefined) out.pollIntervalMs = r; }
    patch.board = out;
  }
  if (isObj(input.webcam)) {
    const w = input.webcam, out: Partial<Config["webcam"]> = {};
    if ("device" in w) { const r = str("webcam", "device", w.device); if (r !== undefined) out.device = r; }
    if ("width" in w) { const r = num("webcam", "width", w.width, { min: 1, int: true }); if (r !== undefined) out.width = r; }
    if ("height" in w) { const r = num("webcam", "height", w.height, { min: 1, int: true }); if (r !== undefined) out.height = r; }
    if ("fps" in w) { const r = num("webcam", "fps", w.fps, { min: 1, max: 240, int: true }); if (r !== undefined) out.fps = r; }
    if ("format" in w) {
      if ((WEBCAM_FORMATS as readonly unknown[]).includes(w.format)) out.format = w.format as Config["webcam"]["format"];
      else errors.push(`webcam.format must be one of ${WEBCAM_FORMATS.join(", ")}`);
    }
    if ("encoder" in w) {
      if ((ENCODERS as readonly unknown[]).includes(w.encoder)) out.encoder = w.encoder as Config["webcam"]["encoder"];
      else errors.push(`webcam.encoder must be one of ${ENCODERS.join(", ")}`);
    }
    patch.webcam = out;
  }
  if (isObj(input.recorder)) {
    const rc = input.recorder, out: Partial<Config["recorder"]> = {};
    if ("segmentDir" in rc) { const r = str("recorder", "segmentDir", rc.segmentDir); if (r !== undefined) out.segmentDir = r; }
    if ("clipDir" in rc) { const r = str("recorder", "clipDir", rc.clipDir); if (r !== undefined) out.clipDir = r; }
    if ("segmentSeconds" in rc) { const r = num("recorder", "segmentSeconds", rc.segmentSeconds, { min: 1, int: true }); if (r !== undefined) out.segmentSeconds = r; }
    if ("ringSeconds" in rc) { const r = num("recorder", "ringSeconds", rc.ringSeconds, { min: 5, int: true }); if (r !== undefined) out.ringSeconds = r; }
    if ("preRollMs" in rc) { const r = num("recorder", "preRollMs", rc.preRollMs, { min: 0 }); if (r !== undefined) out.preRollMs = r; }
    if ("postRollMs" in rc) { const r = num("recorder", "postRollMs", rc.postRollMs, { min: 0 }); if (r !== undefined) out.postRollMs = r; }
    patch.recorder = out;
  }
  if (isObj(input.visit)) {
    const vi = input.visit, out: Partial<Config["visit"]> = {};
    for (const k of ["inactivityTimeoutMs", "thirdDartGraceMs", "collectTimeoutMs"] as const) {
      if (k in vi) { const r = num("visit", k, vi[k], { min: 0 }); if (r !== undefined) out[k] = r; }
    }
    patch.visit = out;
  }
  if ("retainCount" in input) {
    const r = num("config", "retainCount", input.retainCount, { min: 1, max: 1000, int: true });
    if (r !== undefined) patch.retainCount = r;
  }
  if (isObj(input.server)) {
    const s = input.server, out: Partial<Config["server"]> = {};
    if ("port" in s) { const r = num("server", "port", s.port, { min: 1, max: 65535, int: true }); if (r !== undefined) out.port = r; }
    patch.server = out;
  }

  return { patch, errors };
}

export function loadConfigSync(): Config {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return merge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(patch: ConfigPatch): Promise<Config> {
  const current = await loadConfig();
  const next = merge(current, patch);
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/** Resolve a possibly-relative config path against the repo root. */
export function resolvePath(p: string): string {
  return resolve(ROOT, p);
}
