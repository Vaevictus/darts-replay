import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Config, ConfigPatch } from "@shared/types.js";
import { logger } from "./log.js";

export type { ConfigPatch };

const log = logger("config");

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Install root. Defaults to the repo root (server/src/ -> ../../) so running
 * from a checkout "just works". Packaged installs (deb, container) may point it
 * elsewhere via `DARTS_ROOT` (e.g. /opt/darts-replay).
 */
export const ROOT = process.env.DARTS_ROOT ? resolve(process.env.DARTS_ROOT) : resolve(__dirname, "../..");

/** Config file location. `DARTS_CONFIG` overrides it (e.g. /etc/darts-replay/config.json). */
const CONFIG_PATH = process.env.DARTS_CONFIG ? resolve(process.env.DARTS_CONFIG) : resolve(ROOT, "config.json");

/**
 * Writable data root for clips/share/visits. Defaults to `<ROOT>/var`; packaged
 * installs point `DARTS_DATA` at a persistent path (e.g. /var/lib/darts-replay).
 */
const DATA_ROOT = process.env.DARTS_DATA ? resolve(process.env.DARTS_DATA) : resolve(ROOT, "var");

export const DEFAULT_CONFIG: Config = {
  board: { host: "127.0.0.1", port: 3180, pollIntervalMs: 150 },
  webcam: {
    device: "/dev/video6",
    width: 1280,
    height: 720,
    fps: 30,
    format: "mjpeg",
    encoder: "x264",
    rotation: 0,
    flipH: false,
    flipV: false,
  },
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
  calibration: {
    board: { x: 0.5, y: 0.5, scale: 0.6, rotation: 0, opacity: 0.4, show: false },
  },
  sharing: {
    defaultHost: "none",
    burnBoard: true,
    burnGuides: true,
    burnDarts: false,
    burnCaption: true,
    streamable: { email: "", password: "" },
  },
};

/** Merge a partial config over a base, section by section (one level of nesting,
 * plus the two-level `calibration.board`). */
export function merge(base: Config, over: ConfigPatch): Config {
  return {
    board: { ...base.board, ...over.board },
    webcam: { ...base.webcam, ...over.webcam },
    recorder: { ...base.recorder, ...over.recorder },
    visit: { ...base.visit, ...over.visit },
    retainCount: over.retainCount ?? base.retainCount,
    server: { ...base.server, ...over.server },
    calibration: { board: { ...base.calibration.board, ...over.calibration?.board } },
    sharing: {
      ...base.sharing,
      ...over.sharing,
      streamable: { ...base.sharing.streamable, ...over.sharing?.streamable },
    },
  };
}

export const WEBCAM_FORMATS = ["h264", "mjpeg", "yuyv422"] as const;
const ENCODERS = ["copy", "x264", "vaapi"] as const;
export const ROTATIONS = [0, 90, 180, 270] as const;
const SHARE_HOSTS = ["none", "catbox", "streamable"] as const;

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
  const bool = (sec: string, k: string, v: unknown) =>
    typeof v === "boolean" ? v : void errors.push(`${sec}.${k} must be a boolean`);

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
    if ("rotation" in w) {
      if ((ROTATIONS as readonly unknown[]).includes(w.rotation)) out.rotation = w.rotation as Config["webcam"]["rotation"];
      else errors.push(`webcam.rotation must be one of ${ROTATIONS.join(", ")}`);
    }
    if ("flipH" in w) { const r = bool("webcam", "flipH", w.flipH); if (r !== undefined) out.flipH = r; }
    if ("flipV" in w) { const r = bool("webcam", "flipV", w.flipV); if (r !== undefined) out.flipV = r; }
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
  if (isObj(input.calibration) && isObj(input.calibration.board)) {
    const b = input.calibration.board, out: Partial<Config["calibration"]["board"]> = {};
    for (const k of ["x", "y", "scale", "opacity"] as const) {
      if (k in b) { const r = num("calibration.board", k, b[k], { min: 0, max: 1 }); if (r !== undefined) out[k] = r; }
    }
    if ("rotation" in b) { const r = num("calibration.board", "rotation", b.rotation, { min: 0, max: 360 }); if (r !== undefined) out.rotation = r; }
    if ("show" in b) { const r = bool("calibration.board", "show", b.show); if (r !== undefined) out.show = r; }
    patch.calibration = { board: out };
  }
  if (isObj(input.sharing)) {
    const sh = input.sharing;
    const out: NonNullable<ConfigPatch["sharing"]> = {};
    if ("defaultHost" in sh) {
      if ((SHARE_HOSTS as readonly unknown[]).includes(sh.defaultHost)) out.defaultHost = sh.defaultHost as Config["sharing"]["defaultHost"];
      else errors.push(`sharing.defaultHost must be one of ${SHARE_HOSTS.join(", ")}`);
    }
    for (const k of ["burnBoard", "burnGuides", "burnDarts", "burnCaption"] as const) {
      if (k in sh) { const r = bool("sharing", k, sh[k]); if (r !== undefined) out[k] = r; }
    }
    if (isObj(sh.streamable)) {
      const st = sh.streamable, so: Partial<Config["sharing"]["streamable"]> = {};
      for (const k of ["email", "password"] as const) {
        // Empty strings are valid here (means "unset"), so don't use the non-empty `str`.
        if (k in st) {
          if (typeof st[k] === "string") so[k] = st[k] as string;
          else errors.push(`sharing.streamable.${k} must be a string`);
        }
      }
      out.streamable = so;
    }
    patch.sharing = out;
  }

  return { patch, errors };
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Warn once, loudly, that the config is unusable so it can't be lost silently. */
function warnMalformed(err: unknown): void {
  log.error(
    `config at ${CONFIG_PATH} is malformed and was ignored — using defaults. ` +
      `Fix the JSON and restart; the file will NOT be overwritten by saves until it parses. ` +
      `(${(err as Error).message})`,
  );
}

export function loadConfigSync(): Config {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch (err) {
    warnMalformed(err);
    return DEFAULT_CONFIG;
  }
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if (isMissing(err)) return DEFAULT_CONFIG; // no config yet — defaults are expected
    throw err; // an unexpected IO error should surface, not masquerade as defaults
  }
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch (err) {
    warnMalformed(err);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(patch: ConfigPatch): Promise<Config> {
  // Read the current file directly so we never overwrite a config that exists
  // but fails to parse — a stray syntax error must not silently wipe the user's
  // camera setup and Streamable credentials with defaults+patch.
  let current: Config = DEFAULT_CONFIG;
  let existing: string | null = null;
  try {
    existing = await readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  if (existing !== null) {
    try {
      current = merge(DEFAULT_CONFIG, JSON.parse(existing));
    } catch (err) {
      throw new Error(`refusing to overwrite malformed config at ${CONFIG_PATH}: ${(err as Error).message}`);
    }
  }
  const next = merge(current, patch);
  // Atomic write: a crash mid-write can't leave a truncated/corrupt config.
  const tmp = `${CONFIG_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, CONFIG_PATH);
  return next;
}

/** Resolve a possibly-relative path against the install root (for app assets like web/dist). */
export function resolvePath(p: string): string {
  return resolve(ROOT, p);
}

/** Resolve a path under the writable data root (clips, share, visits.json). */
export function dataPath(...segments: string[]): string {
  return resolve(DATA_ROOT, ...segments);
}

/**
 * Absolute clips directory for a given config. Honors an absolute `clipDir`;
 * otherwise resolves it under the data root, tolerating the legacy `var/`
 * prefix so existing `config.json` files keep working when `DARTS_DATA` is set.
 */
export function clipsDir(cfg: Config): string {
  const dir = cfg.recorder.clipDir;
  if (isAbsolute(dir)) return dir;
  return dataPath(dir.replace(/^var[/\\]/, ""));
}
