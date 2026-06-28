import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import type { Config } from "@shared/types.js";

const WS_OPEN = 1; // WebSocket.OPEN
import { Engine, type ServerMessage } from "./engine.js";
import { VisitStore } from "./store/visits.js";
import { resolvePath, saveConfig, validateConfigPatch } from "./config.js";
import { logger } from "./log.js";

const log = logger("ws");

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
    ws.send(JSON.stringify({ type: "state", phase: s.phase, dartsCount: s.dartsCount, board: s.board }));
    for (const v of store.list(cfg.retainCount).reverse()) {
      ws.send(JSON.stringify({ type: v.clipUrl ? "visit-ready" : "visit", visit: v }));
    }
  });

  return { app, engine };
}
