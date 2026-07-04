# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Redesigned Settings dialog** with a left-hand section nav (Camera, Board,
  Replays, Heatmap, Sharing, Advanced, Status) that swaps the panel instead of one
  long scroll, and plain-language labels + a helper line on every option (durations
  shown in **seconds**, jargon like poll/encoder/ring buffer explained or tucked
  under an Advanced warning). Collapses to a scrollable strip on narrow screens.
- **Heatmap "grouping" control** — the per-dart heat radius is now tunable
  (Tight / Standard / Loose presets + a Tighter↔Looser slider, framed as "how close
  together must darts land to count as a group?") with a live preview of your own
  darts. The relative/absolute scale is reworded as "My tightest group" vs "Only
  real pile-ups". Persisted client-side; changes apply instantly.

### Changed
- **Heatmap resolution & hotness.** The per-dart kernel was ~0.20 board-radii
  (≈33 mm), so darts anywhere in the same segment merged into a hot blob. Shrunk
  it ~3× (≈12 mm, roughly one dart-width) so a spot only heats up when hits land
  practically on top of each other, and made the default intensity scale
  **absolute** (a spot goes red on real pile-up, ~4 stacked darts) instead of
  relative (which always painted the densest cluster red regardless of tightness).

## [0.2.2] - 2026-07-04

### Fixed
- **`.deb` upgrades really do restart the service now.** The previous attempt was a
  no-op: `prerm` stopped the service on upgrade, so `postinst`'s `try-restart` found
  nothing running. `prerm` no longer stops on upgrade, and `postinst` `restart`s the
  service if it's enabled — so the recorder comes back on the new code (a user who
  `systemctl disable`d it is left alone). Verified with a mock-`systemctl` trace.
- Runtime `recorder.clipDir` changes (via Settings) no longer break clip extraction:
  `extractClip` ensures the clips dir exists before writing (closes the last of the
  C1 family for hot config edits).
- Clip-share uploads now time out across the whole request (`AbortSignal.timeout`),
  not just the response headers — a slow-drip upload body can't wedge the serialized
  `/api/share` job past the deadline.
- The web config cache is invalidated on a WS `config` broadcast, so a component that
  mounts after another client changed the config no longer reads a stale value.
- Clients now drop a visit card the moment its clip is pruned (a `visit-removed`
  WS frame), instead of leaving a card whose `/clips/…` 404s until reload; the
  player also stops if the clip it was showing is pruned.
- `/api/health` `ok` now reflects real health (capture ring producing segments,
  or intentionally paused for preview) rather than being a hard-coded `true`.

### Changed
- `ConfigPatch` is defined once in `shared/types.ts` and imported by both the
  server and the web client (was duplicated, and the web copy couldn't express
  the two-level `calibration.board` / `sharing.streamable` nesting).
- The two startup `/api/config` reads (`useFps`, `useBoardCalibration`) share one
  cached fetch; the cache is invalidated on save so post-save reads are fresh.

## [0.2.1] - 2026-07-04

### Fixed
- **The `.deb` no longer crash-loops on first start.** The ring buffer tried to
  `mkdir` a relative `clipDir` under the read-only `/opt` install root; the clips
  dir is created by the visit store (correctly resolved) instead.
- **Saved visits ("reference-form library") stay visible.** New clients were primed
  with only the newest `retainCount` visits, so saved visits scrolled out of view;
  the WS prime and `/api/visits` now surface all persisted visits.
- **`vaapi` recordings keep their rotation/flip.** Orientation and the vaapi
  `format=nv12,hwupload` were emitted as two `-vf` args (ffmpeg honors only the
  last), silently dropping orientation; they're now merged into one filter chain.
- **`.deb` upgrades restart the service** (`try-restart` in `postinst`), so an
  `apt` upgrade no longer leaves the recorder silently stopped.
- **A malformed `config.json` is never silently overwritten.** Parse errors are
  logged loudly and `saveConfig` refuses to clobber an unparseable file (which
  previously replaced the user's camera setup + Streamable credentials with defaults).
- Ring-buffer respawn timer is cancelled on stop/restart (prevents an orphaned
  second ffmpeg fighting over the camera during a preview open/close race).
- Share exports clean up overlay PNGs and stitch intermediates even on failure;
  uploads have a 5-minute timeout so a wedged upload can't hang the request.
- Visit numbers continue across restarts (the FSM seq is seeded from the store).
- Container runs the app as PID 1 (`node …` not `npm start`) for clean SIGTERM
  shutdown; atomic writes for `config.json` and the visits index; `/api/board/test`
  validates the host; `/api/share` caps the batch and serializes jobs; Settings
  number fields no longer snap to `0` while being edited.

### Changed
- `react`/`react-dom` moved to devDependencies (build-only) — slims the container
  image and `.deb` runtime. `engines.node` corrected to `^20.19 || >=22.12` (Vite 7).
- Docs: install methods now state which need root and that rootless podman needs the
  `uidmap` package; README config table and ARCHITECTURE module graph refreshed; a
  storage note documents that `share/` exports are not auto-pruned.

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

[Unreleased]: https://github.com/Vaevictus/darts-replay/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/Vaevictus/darts-replay/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Vaevictus/darts-replay/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Vaevictus/darts-replay/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vaevictus/darts-replay/releases/tag/v0.1.0
