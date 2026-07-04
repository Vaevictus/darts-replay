# syntax=docker/dockerfile:1
# darts-replay container image.
#
# Multi-stage: build the web bundle with the full toolchain, then assemble a
# lean runtime with only production deps + ffmpeg. The server runs its
# TypeScript directly via tsx (a runtime dependency), so the source, shared/
# and tsconfig.json (for the @shared/* path alias) all ship in the image.
#
# Runs on rootless podman: with default rootless mapping, container root maps to
# your unprivileged host user, so a bind-mounted /dev/video* and the data volume
# are accessed with your own credentials. See deploy/README.md.

# ---- build stage: compile the SPA ----
FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY web ./web
COPY shared ./shared
RUN npm run build

# ---- runtime stage ----
FROM docker.io/library/node:22-bookworm-slim
ENV NODE_ENV=production \
    DARTS_DATA=/data \
    DARTS_CONFIG=/config/config.json

# ffmpeg (+libx264) is the only system dependency; resvg ships a prebuilt binary via npm.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# App code (server runs from TS via tsx) + the built SPA.
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY config.example.json ./
COPY --from=build /app/web/dist ./web/dist

# Data (clips/share/visits) and config live on mounted volumes.
RUN mkdir -p /data /config
VOLUME ["/data", "/config"]
EXPOSE 8787

# The ring buffer wants a roomy /dev/shm; the recorder falls back gracefully but
# give it space via --shm-size (compose sets shm_size: 256m).
CMD ["npm", "start"]
