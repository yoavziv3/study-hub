#!/bin/zsh
# Installs the portal reader on an old Android phone left on at home (Termux), as a service that starts by itself.
# A home connection is Israeli, so the portal answers it; the Mac stays the backup.
#   ./scripts/deploy-portal-android.sh <the phone's IP on the home Wi-Fi>
# Needs, on the phone: Termux + Termux:Boot (both from F-Droid), `pkg install openssh nodejs termux-services`,
# sshd running, and this Mac's key in it (ssh-copy-id -i ~/.ssh/phone_relay -p 8022 <ip>). On the Mac:
# CLOUD_URL and STUDY_ADMIN_SECRET in .env, and portal-key.json. Safe to run again (updates and restarts).
set -euo pipefail
cd "$(dirname "$0")/.."

IP=${1:?usage: ./scripts/deploy-portal-android.sh <phone ip>}
PORT=${PORT:-8022}
KEY=${SSH_KEY:-$HOME/.ssh/phone_relay}
OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

[[ -f portal-key.json ]] || { echo "portal-key.json is missing – run: node scripts/portal-key.js"; exit 1; }

# ---------- package: the reader, the shared code, settings (private files stay 600) ----------
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
cp relay/run.mjs "$BUILD/"
mkdir "$BUILD/shared"
cp shared/portal-api.js shared/portal-relay-core.js "$BUILD/shared/"
echo '{"type":"module"}' > "$BUILD/package.json"
(umask 077
  grep -E '^CLOUD_URL=' .env > "$BUILD/relay.env"
  grep -E '^STUDY_ADMIN_SECRET=' .env | sed 's/^STUDY_ADMIN_SECRET=/ADMIN_SECRET=/' >> "$BUILD/relay.env"
  echo "SOURCE=phone" >> "$BUILD/relay.env"
  cp portal-key.json "$BUILD/portal-key.json")
[[ $(wc -l < "$BUILD/relay.env") -eq 3 ]] || { echo "CLOUD_URL / STUDY_ADMIN_SECRET missing in .env"; exit 1; }
(cd "$BUILD" && tar czf bundle.tgz run.mjs package.json shared relay.env portal-key.json)

echo "copying to the phone ($IP)"
scp "${OPTS[@]}" -P "$PORT" -q "$BUILD/bundle.tgz" "$IP:portal-relay.tgz"

ssh "${OPTS[@]}" -p "$PORT" "$IP" 'bash -s' <<'REMOTE'
set -euo pipefail
DIR=$HOME/portal-relay
NODE_MAJOR=$(node -v 2>/dev/null | cut -c2- | cut -d. -f1 || echo 0)
[[ ${NODE_MAJOR:-0} -ge 20 ]] || { echo "Node 20+ is needed – in Termux: pkg install nodejs"; exit 1; }
command -v sv-enable >/dev/null || { echo "termux-services is missing – in Termux: pkg install termux-services, then close and reopen Termux"; exit 1; }
mkdir -p "$DIR"
tar xzf "$HOME/portal-relay.tgz" -C "$DIR"
rm -f "$HOME/portal-relay.tgz"
chmod 600 "$DIR/relay.env" "$DIR/portal-key.json"

echo -n "portal from the phone: "
PING=$(cd "$DIR" && node run.mjs --ping)
echo "$PING"
if ! grep -q '"status":200' <<<"$PING"; then
  echo "The portal doesn't answer the phone – not starting the service. The Mac keeps reading the portal."
  exit 1
fi

# A service (termux-services/runit): restarted if it stops, logs in $PREFIX/var/log/sv/portal-relay.
SV=$PREFIX/var/service/portal-relay
mkdir -p "$SV/log" "$PREFIX/var/log/sv/portal-relay"
cat > "$SV/run" <<RUN
#!/data/data/com.termux/files/usr/bin/sh
cd "$DIR"
exec node run.mjs 2>&1
RUN
cat > "$SV/log/run" <<RUN
#!/data/data/com.termux/files/usr/bin/sh
exec svlogd -tt "$PREFIX/var/log/sv/portal-relay"
RUN
chmod +x "$SV/run" "$SV/log/run"
sv-enable portal-relay >/dev/null 2>&1 || true
sv-enable sshd >/dev/null 2>&1 || true # so updates can be installed the same way later
sv restart portal-relay >/dev/null 2>&1 || sv up portal-relay

# After a restart of the phone: Termux:Boot starts Termux, keeps the phone awake for it, and starts the services.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-services" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
. $PREFIX/etc/profile
BOOT
chmod +x "$HOME/.termux/boot/start-services"
termux-wake-lock 2>/dev/null || true

sleep 6
sv status portal-relay
tail -n 5 "$PREFIX/var/log/sv/portal-relay/current" 2>/dev/null || true
REMOTE
echo "done: the portal reader runs on the phone every minute; the Mac steps aside while it does."
