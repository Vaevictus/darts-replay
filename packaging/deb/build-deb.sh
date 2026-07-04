#!/usr/bin/env bash
# Build a self-contained darts-replay .deb (bundles a Node.js runtime + prod
# deps + built SPA). Arch-specific because of the bundled Node binary and the
# native @resvg/resvg-js addon, so run it once per target architecture.
#
# Usage:
#   packaging/deb/build-deb.sh [version] [debarch]
# Examples:
#   packaging/deb/build-deb.sh                 # version from package.json, host arch
#   packaging/deb/build-deb.sh 0.2.0 arm64     # cross-label (run on matching arch)
#
# Env:
#   NODE_VERSION   Node runtime to bundle (default below)
#   OUTDIR         where the .deb lands (default: dist/)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

VERSION="${1:-$(node -p "require('./package.json').version")}"
DEBARCH="${2:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
OUTDIR="${OUTDIR:-$REPO/dist}"

case "$DEBARCH" in
  amd64) NODEARCH=x64 ;;
  arm64) NODEARCH=arm64 ;;
  armhf) NODEARCH=armv7l ;;
  *) echo "unsupported arch: $DEBARCH" >&2; exit 1 ;;
esac

echo ">> darts-replay ${VERSION} (${DEBARCH}), bundling Node ${NODE_VERSION} (${NODEARCH})"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/pkg"
APP="$PKG/opt/darts-replay"
mkdir -p "$APP"

echo ">> Building web bundle"
npm ci --no-audit --no-fund
npm run build

echo ">> Installing production dependencies (arch-native)"
cp package.json package-lock.json "$APP/"
(
  cd "$APP"
  npm ci --omit=dev --no-audit --no-fund   # must succeed; set -e aborts on failure
  npm cache clean --force >/dev/null 2>&1 || true
)

echo ">> Staging application files"
cp -r server shared "$APP/"
mkdir -p "$APP/web"
cp -r web/dist "$APP/web/dist"
cp tsconfig.json config.example.json "$APP/"

echo ">> Fetching Node ${NODE_VERSION} runtime"
NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODEARCH}.tar.xz"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" -o "$STAGE/node.tar.xz"
mkdir -p "$STAGE/node" "$APP/runtime/bin"
tar -xJf "$STAGE/node.tar.xz" -C "$STAGE/node" --strip-components=1
# We only need the node binary; npm/headers are dropped to keep the package small.
cp "$STAGE/node/bin/node" "$APP/runtime/bin/node"

echo ">> Laying out FHS files"
install -Dm755 packaging/deb/darts-replay.wrapper "$PKG/usr/bin/darts-replay"
install -Dm644 packaging/deb/darts-replay.service "$PKG/lib/systemd/system/darts-replay.service"

echo ">> Writing DEBIAN metadata"
mkdir -p "$PKG/DEBIAN"
INSTALLED_KB="$(du -s -k "$PKG" | cut -f1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: darts-replay
Version: ${VERSION}
Architecture: ${DEBARCH}
Maintainer: Vaevictus <Vaevictus@users.noreply.github.com>
Installed-Size: ${INSTALLED_KB}
Depends: ffmpeg
Recommends: v4l-utils
Section: video
Priority: optional
Homepage: https://github.com/Vaevictus/darts-replay
Description: Instant replay & throw-form self-coaching for Autodarts
 Records each visit on a spare webcam, auto-plays it in your browser paired
 with an exact SVG of what you hit, and can burn overlays into clips for
 sharing to e.g. /r/darts. Bundles its own Node.js runtime; needs ffmpeg and
 a spare V4L2 webcam separate from the ones Autodarts uses for detection.
EOF

for s in postinst prerm postrm; do
  install -Dm755 "packaging/deb/$s" "$PKG/DEBIAN/$s"
done

echo ">> Building package"
mkdir -p "$OUTDIR"
DEB="$OUTDIR/darts-replay_${VERSION}_${DEBARCH}.deb"
dpkg-deb --build --root-owner-group "$PKG" "$DEB"

echo ">> Built $DEB"
dpkg-deb --info "$DEB" | sed 's/^/   /'
