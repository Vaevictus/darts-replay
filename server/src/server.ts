import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import type { Config } from "@shared/types.js";

const WS_OPEN = 1; // WebSocket.OPEN
import { Engine, type ServerMessage } from "./engine.js";
import { VisitStore, validateVisitPatch } from "./store/visits.js";
import { resolvePath, saveConfig, validateConfigPatch, WEBCAM_FORMATS, ROTATIONS } from "./config.js";
import { listCameras } from "./cameras.js";
import { fetchWithTimeout } from "./fetch.js";
import type { WebcamOverride } from "./recorder/preview.js";
import { logger } from "./log.js";

const log = logger("ws");

const STREAM_FORMATS = new Set<unknown>(WEBCAM_FORMATS);
const STREAM_ROTATIONS = new Set<unknown>(ROTATIONS);

// Board Manager control endpoints (POST, empty body), captured from the local
// :3180 UI. `reset` re-arms the board to the throw-ready state; `calibrate` kicks
// off auto camera calibration.
const BOARD_COMMANDS: Record<string, string> = {
  reset: "/api/reset",
  calibrate: "/api/config/calibration/auto?distortion=true",
};

/** POST a command to the autodarts Board Manager. Returns a small result object
 * (never throws) so the route can relay success/failure to the UI. */
async function postToBoard(host: string, port: number, path: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`http://${host}:${port}${path}`, 5000, { method: "POST" });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
  }
}

/** Validate the live-stream query overrides — these feed ffmpeg args, so only
 * recognized, well-formed values are accepted. */
function parseStreamOverride(q: Record<string, string>): WebcamOverride {
  const o: WebcamOverride = {};
  if (typeof q.device === "string" && /^\/dev\/video\d+$/.test(q.device)) o.device = q.device;
  if (STREAM_FORMATS.has(q.format)) o.format = q.format as WebcamOverride["format"];
  const int = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const w = q.width !== undefined ? int(q.width, 16, 10000) : undefined;
  if (w !== undefined) o.width = w;
  const h = q.height !== undefined ? int(q.height, 16, 10000) : undefined;
  if (h !== undefined) o.height = h;
  const fps = q.fps !== undefined ? int(q.fps, 1, 240) : undefined;
  if (fps !== undefined) o.fps = fps;
  const rot = Number(q.rotation);
  if (q.rotation !== undefined && STREAM_ROTATIONS.has(rot)) o.rotation = rot as WebcamOverride["rotation"];
  if (q.flipH !== undefined) o.flipH = q.flipH === "1" || q.flipH === "true";
  if (q.flipV !== undefined) o.flipV = q.flipV === "1" || q.flipV === "true";
  return o;
}

export interface AppDeps {
  config: Config;
  store: VisitStore;
}

export async function buildServer({ config, store }: AppDeps): Promise<{
  app: FastifyInstance;
  engine: Engine;
}> {
  const app = Fastify({ logger: false });
  let cfg = config;

  // MUST be awaited before any routes: @fastify/websocket installs its onRoute
  // hook when the plugin finishes loading, and that hook (which upgrades a
  // { websocket: true } route) only fires for routes registered AFTER it exists.
  // Without the await, GET /ws was registered as a plain HTTP route.
  await app.register(fastifyWebsocket);

  // Broadcast over the ws server's own client set — guaranteed real sockets.
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const client of app.websocketServer.clients) {
      if (client.readyState === WS_OPEN) {
        try {
          client.send(data);
        } catch {
          /* client went away mid-send */
        }
      }
    }
  };

  const engine = new Engine(cfg, store, broadcast);

  // Clips: served with HTTP range support for <video> seeking.
  void app.register(fastifyStatic, {
    root: resolvePath(cfg.recorder.clipDir),
    prefix: "/clips/",
    decorateReply: true,
  });

  // Built SPA (web/dist). Registered only if present (dev uses the vite server).
  const webDist = resolvePath("web/dist");
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: false });
  }

  app.get("/api/health", async () => ({ ok: true, ...engine.getState() }));

  app.get("/api/state", async () => engine.getState());

  app.get<{ Querystring: { limit?: string } }>("/api/visits", async (req, reply) => {
    let limit: number | undefined;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n < 1) {
        return reply.code(400).send({ error: "limit must be a positive integer" });
      }
      limit = Math.min(n, cfg.retainCount);
    }
    return store.list(limit);
  });

  app.get<{ Params: { id: string } }>("/api/visits/:id", async (req, reply) => {
    const v = store.get(req.params.id);
    if (!v) return reply.code(404).send({ error: "not found" });
    return v;
  });

  // Update self-review metadata (rating / saved / note).
  app.patch<{ Params: { id: string } }>("/api/visits/:id", async (req, reply) => {
    const { patch, errors } = validateVisitPatch(req.body);
    if (errors.length) return reply.code(400).send({ error: "invalid patch", details: errors });
    const updated = await store.update(req.params.id, patch);
    if (!updated) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "visit", visit: updated });
    return updated;
  });

  app.get("/api/config", async () => cfg);

  app.put("/api/config", async (req, reply) => {
    const { patch, errors } = validateConfigPatch(req.body);
    if (errors.length) return reply.code(400).send({ error: "invalid config", details: errors });
    cfg = await saveConfig(patch);
    engine.updateConfig(cfg);
    broadcast({ type: "config", config: cfg });
    return { config: cfg, note: "device/recorder changes take effect after a restart" };
  });

  app.post<{ Params: { id: string } }>("/api/replay/:id", async (req, reply) => {
    if (!engine.replay(req.params.id)) return reply.code(404).send({ error: "no clip" });
    return { ok: true };
  });

  // --- Camera setup (Settings screen) ------------------------------------------

  // Available cameras + capabilities (safe to call while recording).
  app.get("/api/cameras", async () => listCameras());

  // Test an autodarts board address — host/port from the body so the user can
  // verify a connection before saving it.
  app.post<{ Body: { host?: unknown; port?: unknown } }>("/api/board/test", async (req, reply) => {
    const host = typeof req.body?.host === "string" && req.body.host ? req.body.host : cfg.board.host;
    const port = Number.isInteger(req.body?.port) ? (req.body!.port as number) : cfg.board.port;
    try {
      const res = await fetchWithTimeout(`http://${host}:${port}/api/state`, 2000);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const body = (await res.json()) as { status?: unknown; connected?: unknown };
      return { ok: true, status: typeof body.status === "string" ? body.status : "reachable", connected: body.connected === true };
    } catch (err) {
      return reply.code(200).send({ ok: false, error: err instanceof Error ? err.message : "unreachable" });
    }
  });

  // Board Manager quick actions (reset / re-arm, calibrate). Proxied so the
  // browser doesn't issue cross-origin POSTs to the board.
  app.post<{ Params: { action: string } }>("/api/board/command/:action", async (req, reply) => {
    const path = BOARD_COMMANDS[req.params.action];
    if (!path) return reply.code(404).send({ ok: false, error: "unknown action" });
    return postToBoard(cfg.board.host, cfg.board.port, path);
  });

  // Pause recording and enter live-preview mode.
  app.post("/api/camera/preview/start", async () => {
    await engine.startPreview();
    return { ok: true, previewing: true };
  });

  // Leave live-preview mode and resume recording.
  app.post("/api/camera/preview/stop", async () => {
    engine.stopPreview();
    return { ok: true, previewing: false };
  });

  // Live multipart-MJPEG stream of the camera (only while in preview mode). We
  // hijack the reply and drive the raw response directly from ffmpeg's stdout.
  // Query params override saved webcam settings so the view reflects unsaved edits.
  app.get<{ Querystring: Record<string, string> }>("/api/camera/stream", async (req, reply) => {
    reply.hijack();
    try {
      await engine.streamPreview(reply.raw, parseStreamOverride(req.query));
    } catch (err) {
      log.error("preview stream error:", err);
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    }
  });

  app.get("/ws", { websocket: true }, (socket) => {
    // Some @fastify/websocket builds hand the handler a connection wrapper rather
    // than the raw ws; resolve whichever actually has .send().
    const conn = socket as unknown as { send?: (d: string) => void; socket?: { send: (d: string) => void } };
    const ws = typeof conn.send === "function" ? conn : conn.socket;
    if (!ws || typeof ws.send !== "function") {
      log.error("cannot resolve a sendable socket:", socket?.constructor?.name, Object.keys(socket ?? {}));
      return;
    }
    // Prime the new client with current state + recent visits.
    const s = engine.getState();
    ws.send(JSON.stringify({ type: "state", phase: s.phase, dartsCount: s.dartsCount, board: s.board, darts: s.darts }));
    for (const v of store.list(cfg.retainCount).reverse()) {
      ws.send(JSON.stringify({ type: v.clipUrl ? "visit-ready" : "visit", visit: v }));
    }
  });

  return { app, engine };
}
