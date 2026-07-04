import type { Camera, Config, ConfigPatch, OverlayConfig, ShareOptions, ShareResult, Visit } from "@shared/types.js";

export type { Camera, CameraFormat, CameraSize, ConfigPatch } from "@shared/types.js";

export type VisitPatch = Partial<Pick<Visit, "saved" | "rating" | "note">>;

/** Update a visit's self-review metadata. The server echoes a `visit` WS frame,
 * so callers don't need the return value to refresh state. */
export async function patchVisit(id: string, patch: VisitPatch): Promise<Visit> {
  const res = await fetch(`/api/visits/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
  return (await res.json()) as Visit;
}

// --- Config / camera setup ----------------------------------------------------

export async function getConfig(): Promise<Config> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
  return (await res.json()) as Config;
}

// Dedupe the startup config reads (useFps + useBoardCalibration both want it) by
// sharing one in-flight/last promise. Invalidated whenever the config is saved.
let configCache: Promise<Config> | null = null;

/** Config fetch shared across callers that only need a one-time read at startup. */
export function getConfigCached(): Promise<Config> {
  if (!configCache) configCache = getConfig().catch((err) => ((configCache = null), Promise.reject(err)));
  return configCache;
}

/** Drop the cached config so the next read refetches (e.g. after a WS `config`
 * broadcast from another client changed it). */
export function invalidateConfigCache(): void {
  configCache = null;
}

/** Save a config patch. Returns the merged config the server persisted. */
export async function putConfig(patch: ConfigPatch): Promise<Config> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
    throw new Error(body.details?.join("; ") ?? body.error ?? `config save failed: ${res.status}`);
  }
  configCache = null; // config changed — later cached reads must refetch
  return ((await res.json()) as { config: Config }).config;
}

export async function getCameras(): Promise<Camera[]> {
  const res = await fetch("/api/cameras");
  if (!res.ok) throw new Error(`camera list failed: ${res.status}`);
  return (await res.json()) as Camera[];
}

export interface BoardTestResult {
  ok: boolean;
  status?: string;
  connected?: boolean;
  error?: string;
}

export async function testBoard(host: string, port: number): Promise<BoardTestResult> {
  const res = await fetch("/api/board/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host, port }),
  });
  return (await res.json()) as BoardTestResult;
}

export type BoardCommand = "reset" | "calibrate";

/** Trigger a Board Manager quick action (re-arm / calibrate). Never throws —
 * returns the proxied result so the UI can show success or failure. */
export async function boardCommand(action: BoardCommand): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/board/command/${action}`, { method: "POST" });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "request failed" };
  }
}

export async function startPreview(): Promise<void> {
  await fetch("/api/camera/preview/start", { method: "POST" });
}

export async function stopPreview(): Promise<void> {
  await fetch("/api/camera/preview/stop", { method: "POST" });
}

/** Burn overlays into the selected clips (and optionally stitch + upload). The
 * server does all the work; we pass the current guide config + per-export options. */
export async function shareClips(ids: string[], guides: OverlayConfig, options: ShareOptions): Promise<ShareResult> {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, guides, options }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
    throw new Error(body.details?.join("; ") ?? body.error ?? `share failed: ${res.status}`);
  }
  return (await res.json()) as ShareResult;
}
