#!/bin/zsh
# Opens the study site. It normally runs in the background from login (see README); if not, start it here.
cd "$(dirname "$0")"
PORT=${PORT:-5180}
if curl -s -m 2 "http://localhost:$PORT/api/status" >/dev/null; then
  open "http://localhost:$PORT"
  exit 0
fi
[ -d node_modules ] || npm install
npx vite build >/dev/null 2>&1
(sleep 2 && open "http://localhost:$PORT") &
node server/index.js
