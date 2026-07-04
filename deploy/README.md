# Running darts-replay under rootless podman + user systemd

Two ways to auto-start the container as **your** user (no root daemon). Both keep
config in `~/.config/darts-replay` and clips/data in `~/.local/share/darts-replay`.

## Prerequisites

- **podman** installed. Rootless podman also needs the **`uidmap`** package
  (`newuidmap`/`newgidmap` — without them `podman info` fails and containers won't
  start), plus subuid/subgid ranges for your user (`/etc/subuid`, `/etc/subgid`).
  Both are **root** (`apt`) installs done once:
  ```sh
  sudo apt install podman uidmap
  ```
  If you can't get root on your box, this path (and the `.deb`) won't work — use
  the **From source** install (README §Develop / INSTALL §3); it needs no root.
- Your user is in the **`video`** group (for camera access):
  ```sh
  sudo usermod -aG video "$USER"    # log out/in afterwards
  id -nG | tr ' ' '\n' | grep -x video && echo "ok"
  ```
- Know your **spare** camera's capture node: `v4l2-ctl --list-devices`
  (it must be a *different* camera from the ones Autodarts uses for detection).

---

## Option A — Quadlet (recommended)

Quadlet turns a `.container` file into a systemd user service. Cleanest handling
of the camera device, `/dev/shm` size and rootless group pass-through.

> The unit pulls `ghcr.io/vaevictus/darts-replay:latest`. Until the first
> release is published (a `v*` tag), build it locally instead:
> `podman build -t ghcr.io/vaevictus/darts-replay:latest .`

```sh
mkdir -p ~/.config/containers/systemd
cp deploy/darts-replay.container ~/.config/containers/systemd/

# Edit AddDevice= to match your camera:
${EDITOR:-nano} ~/.config/containers/systemd/darts-replay.container

systemctl --user daemon-reload
systemctl --user start darts-replay
loginctl enable-linger "$USER"          # keep running after logout / on boot

# Seed a config (optional — defaults are used if absent):
cp config.example.json ~/.config/darts-replay/config.json

systemctl --user status darts-replay
journalctl --user -u darts-replay -f    # logs
```

Open **http://localhost:8787**. To update: `podman pull ghcr.io/vaevictus/darts-replay:latest`
then `systemctl --user restart darts-replay` (or rely on the `AutoUpdate=registry` label
with `podman auto-update`).

---

## Option B — docker-compose stack as a user service

If you prefer to drive everything from `docker-compose.yml`:

```sh
# from a checkout that has docker-compose.yml:
mkdir -p config data
cp config.example.json config/config.json
${EDITOR:-nano} config/config.json           # set webcam.device + board.host
${EDITOR:-nano} docker-compose.yml           # set devices: to your camera node

# try it in the foreground first:
podman compose up          # Ctrl-C to stop, then -d to detach

# install as a user service:
mkdir -p ~/.config/systemd/user
cp deploy/darts-replay-compose.service ~/.config/systemd/user/darts-replay.service
${EDITOR:-nano} ~/.config/systemd/user/darts-replay.service   # set WorkingDirectory=
systemctl --user daemon-reload
systemctl --user enable --now darts-replay
loginctl enable-linger "$USER"
```

---

## Rootless camera-access notes

- **Default rootless mapping** runs container root as *your* unprivileged host
  user, so a bind-mounted `/dev/video*` is reachable with your own credentials.
- `GroupAdd=keep-groups` (Quadlet) / `group_add: [keep-groups]` (compose) passes
  your host **`video`** membership into the container — needed for the device.
- The tmpfs ring buffer lives in `/dev/shm`; both units bump it to **256 MB**
  (the 64 MB default is too small for a 90 s ring).
- **SELinux** hosts (Fedora/RHEL): the Quadlet volumes already use `:Z`; for
  compose, append `:z` to the volume mounts.
- If the camera still won't open, confirm nothing else holds it
  (`sudo fuser /dev/videoN`) and that the device number is correct.
