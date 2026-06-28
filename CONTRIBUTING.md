# Contributing

Thanks for your interest! darts-replay is a small, focused project — contributions of bug fixes,
hardware-compatibility notes, and docs are very welcome.

## Development setup

```sh
npm install
npm run dev      # server (tsx watch) + Vite dev server with API/WS proxy
```

- **Node ≥ 20** (see `.nvmrc`).
- You do **not** need real hardware to work on most of the codebase — the pure `shared/` tier and the
  server (board adapter, store, config) are all unit-tested without a board or camera.

## The pre-PR gate

```sh
npm run verify   # lint + typecheck + test + build
```

CI runs the same on Node 20 and 22. Please make sure it's green before opening a PR.

## Conventions

- **`shared/` must stay pure and DOM-free** — no `react`, `window`, `document`, or Node I/O imports.
  It's the contract the tests assert against and must run in plain Node. Put logic there and test it.
- **Server code uses the logger** (`server/src/log.ts`), not `console.*` (enforced by ESLint).
- **Tests live in `tests/`**, not next to source. Add/extend tests for any pure-logic change.
- Match the surrounding style; Prettier config is in `.prettierrc.json`.

## Running against hardware

With a real Autodarts Board Manager and a spare webcam:

1. `cp config.example.json config.json` and set `webcam.device` + `board.host`.
2. `npm run probe` to confirm the board is detected (prints live `/api/state` transitions).
3. `npm start` and open `http://localhost:8787`.

The recorder (ffmpeg/V4L2) and the full engine loop are exercised manually this way — they aren't in
the automated suite because they need hardware. If you change the recorder, please describe your
manual test (camera, distro, ffmpeg version) in the PR.

## Reporting bugs / requesting features

Use the issue templates. For bugs, include OS, Node/ffmpeg versions, your webcam, and server logs
(`LOG_LEVEL=debug`).
