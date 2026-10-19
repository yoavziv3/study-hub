#!/bin/zsh
# Builds the cloud site from a specific commit (default: HEAD) and deploys it to Cloudflare Pages.
# Building from the commit – not the working tree – means uncommitted work never goes live.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="${1:-$(git -C "$ROOT" rev-parse HEAD)}"
MSG="$(git -C "$ROOT" log -1 --format=%s "$SHA")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$ROOT" archive "$SHA" | tar -x -C "$TMP"
ln -s "$ROOT/node_modules" "$TMP/node_modules"
cd "$TMP"
node scripts/build-static.js
"$ROOT/node_modules/.bin/wrangler" pages deploy dist-cloud --project-name study-hub --branch main \
  --commit-hash "$SHA" --commit-message "$MSG" --commit-dirty=false
echo "✅ deployed $SHA – $(date)"
