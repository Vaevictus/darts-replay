# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Vaevictus/darts-replay/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Vaevictus/darts-replay/releases/tag/v0.1.0
