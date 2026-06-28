# Architecture

darts-replay is a small Node/TypeScript backend plus a React SPA. The guiding principle (borrowed
from the sibling `x01` project) is a **pure, DOM-free core** that is trivially unit-testable in Node,
with all I/O (HTTP, ffmpeg, the filesystem, the board API) pushed to the edges.

## Module graph

```
shared/            pure, DOM-free, Node-testable — imported by BOTH server and web
  types.ts           Config, Visit, Dart, RawBoardState, …
  state-machine.ts   the visit FSM: (state, signal, cfg) -> (state, effects)
  board.ts           /api/state -> normalized darts + FSM signals
  dartboard.ts       darts -> SVG string
  messages.ts        server -> client WebSocket message union

server/src/        Node I/O tier
  index.ts           entrypoint: load config -> preflight -> build server -> listen
  preflight.ts       startup checks (platform, ffmpeg, camera device)
  config.ts          load/merge/validate config; DEFAULT_CONFIG
  log.ts             tiny leveled logger
  engine.ts          orchestrator: adapter -> FSM -> effects (timers, clips), broadcast
  board/adapter.ts   polls /api/state, diffs snapshots into FSM signals
  recorder/
    ring-buffer.ts   always-on ffmpeg capture into 1s tmpfs segments
    extract.ts       stream-copy concat of segments -> visit clip
  store/visits.ts    in-memory + JSON index, retention/pruning
  server.ts          Fastify: REST + /ws + static clips/SPA

web/src/           React SPA
  main.tsx, App.tsx, useReplay.ts (WS client), Dartboard.tsx, ErrorBoundary.tsx
```

`shared/` has **no** imports of `react`, `window`, `document`, or Node I/O modules — it is the
contract the tests assert against and runs identically in Node and the browser bundle (Vite aliases
`@shared`).

## The visit state machine (`shared/state-machine.ts`)

A pure reducer `step(state, signal, cfg) -> { state, effects[] }`. The host (the engine) performs the
returned effects (start/cancel timers, extract a clip, broadcast a visit). Phases:

```
IDLE ──first dart──▶ RECORDING ──finish──▶ COLLECTING ──re-arm──▶ READY ──first dart──▶ RECORDING
```

**Hybrid, first-wins finish:** a visit ends on the 3rd dart (after a short settle grace), a takeout,
or an inactivity timeout — whichever fires first.

**TAKEOUT vs COLLECTED** — the important real-world subtlety. The Autodarts board sets
`status: "Takeout"` *immediately after the 3rd dart, while the darts are still in the board*, then
clears `throws` only when you physically pull them. So the adapter emits two distinct signals:

- `TAKEOUT` (status entered "Takeout") → **finish the visit + fire the replay**.
- `COLLECTED` (`throws` cleared) → **start the re-arm countdown** (`collectTimeoutMs`).

This matches the desired feel: replay the instant you've thrown, but don't re-arm until you've
actually collected.

## Board access (`server/src/board/adapter.ts`)

The Board Manager does **not** serve a websocket (the `/socket.io` and `/events` paths fall through to
its SPA), so darts-replay **polls** `GET /api/state` (~150 ms). Notable quirk handled here: the board
**omits the `throws` array entirely when there are 0 darts** — a valid state, not a disconnect.
`boardStateToSignals(prev, next)` diffs consecutive snapshots into `DART` / `TAKEOUT` / `COLLECTED` /
`BOARD_IDLE`. The first snapshot is treated as a baseline so leftover darts don't synthesize a
phantom visit.

## Recorder (`server/src/recorder/`)

A single always-on `ffmpeg` captures the webcam into **1-second MPEG-TS segments on tmpfs**. A visit
clip is just a `-c copy` concat of the segments overlapping the visit window → near-instant finalize.

Two decisions worth knowing:

- **Encode, don't copy.** The webcam's *native* H.264 stream carries no PTS, so the segment muxer
  mis-slices it (segments come out ~1.6 s, clip durations wrong). Capturing **MJPEG and encoding with
  `libx264 -preset ultrafast`** yields exact 1.000 s segments at ~0.7 of one core. (VAAPI was tried
  but is unavailable on the target box.)
- **Timestamps from filenames.** ffmpeg `-strftime` stamps each segment's start wall-clock into its
  name (`seg_<epoch>.ts`). An earlier `fs.watch`-based timing approach dropped events under encode
  load and produced clips referencing wrong/pruned segments; deriving time from the filename is exact.

## Data model

```ts
Dart  = { index, name, number, bed, multiplier, points, coords: {x,y} | null }
Visit = { id, seq, darts, totalPoints, startedAt, finishedAt, endReason, clipUrl }
```

Coordinates are normalized to the board: origin at centre, **+x right, +y up, double-ring outer
edge = 1.0**. `shared/dartboard.ts` renders the standard board and plots each dart at `(x, -y)`.

## HTTP / WebSocket contract

REST (JSON):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness + engine/ring status |
| GET | `/api/state` | current FSM phase, dart count, board status |
| GET | `/api/visits?limit=N` | recent visits (newest first) |
| GET | `/api/visits/:id` | one visit |
| GET | `/api/config` / PUT | read / update (validated) config |
| POST | `/api/replay/:id` | push a stored visit to clients to play |
| GET | `/clips/:id.mp4` | the clip (HTTP range enabled for seeking) |

WebSocket `/ws` (server → client), message union in `shared/messages.ts`: `state`, `visit`
(clip pending), `visit-ready` (clip ready → auto-play), `play`, `config`. On connect the server
primes the client with the current state and recent visits.

> **`@fastify/websocket` gotcha:** the plugin's route-upgrade hook only applies to routes registered
> *after* the plugin finishes loading, so `app.register(fastifyWebsocket)` is **awaited** before
> `/ws` is defined (see `server/src/server.ts`). Without the await, `/ws` is a plain HTTP route that
> 500s on upgrade.
