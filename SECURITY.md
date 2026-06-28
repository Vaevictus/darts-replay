# Security Policy

## Threat model

darts-replay is a hobby LAN application. The server binds `0.0.0.0:<port>` and has **no
authentication or authorization** — anyone who can reach the port can view clips, read/modify the
config, and trigger playback. It is intended to run on a **trusted home LAN only**. Do **not** expose
it directly to the internet; if you need remote access, put it behind a VPN or an authenticating
reverse proxy.

It also shells out to `ffmpeg` and reads a local board API; config values like `webcam.device` are
used to build command arguments, so treat write access to `config.json` / the config endpoint as
equivalent to local code execution.

## Reporting a vulnerability

Please report security issues privately via GitHub **Security Advisories**
("Report a vulnerability" on the repository's *Security* tab) rather than a public issue. I'll
acknowledge and respond as time permits — this is a personal project, not a commercial product, so
there are no formal SLAs.

## Supported versions

Only the latest `main` is supported.
