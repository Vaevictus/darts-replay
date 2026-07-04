# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-04

### Added
- **Install options** — three first-class ways to install (see [INSTALL.md](INSTALL.md)):
  a self-contained **`.deb`** for Debian/Ubuntu (bundles a Node runtime, `Depends: ffmpeg`,
  installs a hardened system service under a dedicated `darts-replay` user, FHS layout under
  `/opt`, `/etc/darts-replay`, `/var/lib/darts-replay`); a multi-arch **container image** on
  GHCR driven by [`docker-compose.yml`](docker-compose.yml) for **rootless podman**, with a
  **Quadlet** unit + compose-wrapped unit for a user-level `systemctl --user` service
  ([deploy/README.md](deploy/README.md)); and the existing from-source path. A `release.yml`
  workflow builds and publishes the image and per-arch `.deb`s on each `v*` tag.
- **`DARTS_ROOT` / `DARTS_CONFIG` / `DARTS_DATA`** env overrides so the install dir, config file
  and writable data root can be relocated independently (used by the deb/container). Fully
  back-compatible with the in-repo `config.json` + `var/` layout.

### Changed
- `tsx` moved to runtime dependencies (the server runs its TypeScript directly), so
  `npm ci --omit=dev` and packaged installs can launch without the dev toolchain.

### Added
- **Clip sharing** — select one or more clips (📤 on a card) and export a re-encoded
  H.264 MP4 with the overlays **burned in**: the calibrated board (optionally with the
  visit's dart markers), the reference guide wires, and a small caption — each a per-export
  toggle (defaults configurable under Settings → Sharing). Multiple clips can be stitched
  into one compilation or exported separately. Optional one-click upload to **catbox.moe**
  (no account) or **Streamable** (your account), returning a link to paste into a Reddit
  post; otherwise a local download. Overlays are generated server-side (`buildOverlaySvg` +
  `@resvg/resvg-js`) and burned with a single ffmpeg `overlay` pass — no browser/canvas work.

### Fixed
- Clicking a different clip in the Visits panel while one is playing now switches the
  player to it (the `<video>` is explicitly reloaded on source change).
- Compare view now keeps both clips visible on narrow/portrait displays (frames are
  width-constrained, and the two clips stack vertically in portrait instead of one
  overflowing off-screen).
- The calibrated board overlay now renders over the replay and compare videos at the
  configured position (previously it only appeared in the Settings live view).

### Added
- Replay/compare board overlay reveals each dart **in sync with the video** — markers
  pop in as the throws land (using new per-dart timestamps + clip start time). Hit
  markers are also larger and easier to read.
- **Board quick actions** in the topbar (like the autodarts Play UI): a live board-connection
  indicator, **Reset** (re-arm to the throw-ready state after a missed collect / wrong takeout),
  and **Calibrate** (two-step confirm). Proxied through the server to the Board Manager
  (`POST /api/reset`, `POST /api/config/calibration/auto?distortion=true`).
- In-app **Settings screen** (⚙) for all configuration — no more hand-editing `config.json`:
  autodarts board address (with a "Test connection" button), camera selection with detected
  resolutions/formats/fps, recording timeouts, retention, and an advanced section.
- **Camera orientation** (`webcam.rotation` + `flipH`/`flipV`), applied via an ffmpeg filter
  shared by the recorder and preview. Portrait (90°/270°) captures the player's full stance.
- **Live camera view** for positioning: pauses recording and streams MJPEG straight from the
  camera, with an idle watchdog that always resumes recording. Reflects unsaved edits live.
- Draggable, resizable **wireframe board overlay** plus alignment guides over the live view.
- **Hot-restart** of capture and board reconnection on config save — camera/orientation/board
  changes take effect without a full restart.
- New endpoints: `GET /api/cameras`, `POST /api/board/test`, camera preview start/stop, and a
  `GET /api/camera/stream` MJPEG feed.

## [0.1.0] - 2026-06-28

Initial release.

### Added
- Continuous webcam capture with a tmpfs ring buffer and instant stream-copy per-visit clips.
- Autodarts Board Manager integration via `/api/state` polling.
- Visit state machine with hybrid finish (3rd dart / takeout / inactivity) and a TAKEOUT-vs-COLLECTED
  split so replays fire immediately but re-arm only after the darts are pulled.
- React web app: auto-replay of the latest visit, a review gallery, and an exact SVG dartboard
  rendered from the board's coordinates.
- REST + WebSocket API, configurable via `config.json`.
- Startup preflight checks (platform, ffmpeg, camera) and a leveled logger.

[Unreleased]: https://github.com/Vaevictus/darts-replay/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Vaevictus/darts-replay/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vaevictus/darts-replay/releases/tag/v0.1.0
