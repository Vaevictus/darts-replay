#!/usr/bin/env bash
# Deploy darts-replay to your darts box over SSH and (re)build it there.
#
# Usage:
#   scripts/deploy.sh user@host          # e.g. scripts/deploy.sh pi@10.0.0.5
#   DARTS_HOST=user@host scripts/deploy.sh
#
# Assumes Node is available on the box (system Node, or user-space under
# ~/.local/node as this script's PATH export expects).
set -euo pipefail

TARGET="${1:-${DARTS_HOST:-}}"
if [[ -z "$TARGET" ]]; then
  echo "error: no deploy target. Pass user@host or set DARTS_HOST." >&2
  echo "  scripts/deploy.sh user@host" >&2
  exit 1
fi

DEST="darts-replay"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo ">> Syncing $HERE -> $TARGET:~/$DEST"
rsync -az --delete \
  --exclude node_modules \
  --exclude web/dist \
  --exclude var \
  --exclude config.json \
  --exclude .git \
  "$HERE/" "$TARGET:$DEST/"

echo ">> Installing deps + building on $TARGET"
ssh "$TARGET" "export PATH=\$HOME/.local/node/bin:\$PATH && cd $DEST && npm install --no-audit --no-fund && npm run build"

echo ">> Done. To run:  ssh $TARGET 'cd $DEST && npm start'"
echo ">> To install as a user service:"
echo "   ssh $TARGET 'mkdir -p ~/.config/systemd/user && cp ~/$DEST/systemd/darts-replay.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now darts-replay && loginctl enable-linger \$USER'"
