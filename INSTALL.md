# Installing darts-replay

darts-replay is **Linux-only** (it uses V4L2 capture, a `/dev/shm` tmpfs ring
buffer and `ffmpeg`). Pick whichever install suits you:

| Method | Best for | Auto-start |
| --- | --- | --- |
| [**`.deb` package**](#1-deb-package-debianubuntu) | Debian/Ubuntu boxes | system service |
| [**Container** (rootless podman)](#2-container-rootless-podman) | reproducible, no host Node | user service |
| [**From source**](#3-from-source) | development / other distros | manual / user service |

All three need a **spare V4L2 webcam** *separate from the cameras Autodarts uses
for detection* (V4L2 devices can't be shared between two processes), and a running
**Autodarts Board Manager** reachable on `:3180`. Find your camera with
`v4l2-ctl --list-devices`.

---

## 1. `.deb` package (Debian/Ubuntu)

Self-contained: it **bundles its own Node.js runtime**, so the only system
dependency is `ffmpeg`. Grab the `.deb` for your architecture from the
[latest release](https://github.com/Vaevictus/darts-replay/releases/latest):

```sh
# amd64 (most PCs) or arm64 (Raspberry Pi 4/5, etc.)
sudo apt install ./darts-replay_<version>_amd64.deb
```

`apt` pulls in `ffmpeg` automatically. Then:

```sh
sudoedit /etc/darts-replay/config.json      # set webcam.device and board.host
sudo systemctl start darts-replay           # enabled on install; starts on boot
```

Open **http://localhost:8787**.

- **Runs as** a dedicated `darts-replay` system user (added to the `video` group
  for camera access).
- **Config:** `/etc/darts-replay/config.json` (preserved across upgrades).
- **Data:** `/var/lib/darts-replay` (clips, share exports, `visits.json`).
- **App + runtime:** `/opt/darts-replay`.
- **Logs:** `journalctl -u darts-replay -f`.
- **Remove:** `sudo apt remove darts-replay` (add `--purge` to also delete config
  and recorded clips).

---

## 2. Container (rootless podman)

A multi-arch image is published to
`ghcr.io/vaevictus/darts-replay`. Quickest try, using the bundled
[`docker-compose.yml`](docker-compose.yml):

```sh
git clone https://github.com/Vaevictus/darts-replay.git && cd darts-replay
mkdir -p config data && cp config.example.json config/config.json
# edit config/config.json (webcam.device, board.host) and the devices: line in
# docker-compose.yml to point at your camera, then:
podman compose up -d          # or: docker compose up -d
```

Open **http://localhost:8787**.

For an **auto-starting user-level `systemctl --user` service** (Quadlet or a
compose-wrapped unit), plus rootless camera-access details, see
[deploy/README.md](deploy/README.md).

> You must be in the host **`video`** group for camera access
> (`sudo usermod -aG video "$USER"`, then re-login).

---

## 3. From source

Requires **Node.js ≥ 20** and **`ffmpeg`** on `PATH`.

```sh
git clone https://github.com/Vaevictus/darts-replay.git && cd darts-replay
npm install
cp config.example.json config.json          # then edit
npm run build                               # build the SPA
npm start                                   # serves UI + API on :8787
```

To auto-start on boot as a **user** service (native Node, no container), install
the bundled unit:

```sh
mkdir -p ~/.config/systemd/user
cp systemd/darts-replay.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now darts-replay
loginctl enable-linger "$USER"
```

The `systemd/darts-replay.service` unit assumes a checkout at `~/darts-replay` and
Node under `~/.local/node`; adjust `WorkingDirectory`/`PATH` if yours differ.

See [README.md](README.md#configuration) for all config keys and the dev workflow.

---

## Path overrides (packagers)

The server resolves its locations from three optional env vars (defaults suit an
in-repo checkout):

| Var | Default | Purpose |
| --- | --- | --- |
| `DARTS_ROOT` | repo root | install dir holding `server/`, `shared/`, `web/dist`, `tsconfig.json` |
| `DARTS_CONFIG` | `$DARTS_ROOT/config.json` | config file location |
| `DARTS_DATA` | `$DARTS_ROOT/var` | writable data root (clips, share, `visits.json`) |

The `.deb` and container images set these for FHS-clean / mounted layouts.
