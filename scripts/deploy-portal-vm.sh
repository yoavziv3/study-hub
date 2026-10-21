#!/bin/zsh
# Installs the portal reader on the always-on VM in Israel (Oracle Cloud, Jerusalem) as a systemd service.
#   ./scripts/deploy-portal-vm.sh ubuntu@<the VM's public IP>
# Needs: SSH access to the VM (key in ~/.ssh/oracle_portal, or SSH_KEY=…), CLOUD_URL and STUDY_ADMIN_SECRET in
# .env, and portal-key.json. Safe to run again: it updates the code and settings and restarts the service.
# It checks that the portal answers from the VM before starting anything.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${1:?usage: ./scripts/deploy-portal-vm.sh ubuntu@<ip>}
KEY=${SSH_KEY:-$HOME/.ssh/oracle_portal}
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST")
DIR=/opt/portal-relay

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
  echo "SOURCE=vm" >> "$BUILD/relay.env"
  cp portal-key.json "$BUILD/portal-key.json")
[[ $(wc -l < "$BUILD/relay.env") -eq 3 ]] || { echo "CLOUD_URL / STUDY_ADMIN_SECRET missing in .env"; exit 1; }
(cd "$BUILD" && tar czf bundle.tgz run.mjs package.json shared relay.env portal-key.json)

echo "copying to $HOST"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -q "$BUILD/bundle.tgz" "$HOST:/tmp/portal-relay.tgz"

"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
DIR=/opt/portal-relay
# Node 22 (NodeSource), once
if ! command -v node >/dev/null || [[ $(node -v | cut -c2- | cut -d. -f1) -lt 22 ]]; then
  echo "installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y nodejs >/dev/null
fi
sudo mkdir -p "$DIR"
sudo tar xzf /tmp/portal-relay.tgz -C "$DIR"
rm -f /tmp/portal-relay.tgz
sudo chown -R "$USER":"$USER" "$DIR"
chmod 600 "$DIR/relay.env" "$DIR/portal-key.json"

echo -n "portal from this VM: "
PING=$(cd "$DIR" && node run.mjs --ping)
echo "$PING"
if ! grep -q '"status":200' <<<"$PING"; then
  echo "The portal doesn't answer this VM – not starting the service. The Mac keeps reading the portal."
  exit 1
fi

sudo tee /etc/systemd/system/portal-relay.service >/dev/null <<UNIT
[Unit]
Description=Study Hub – BGU portal reader
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/run.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable portal-relay >/dev/null 2>&1
sudo systemctl restart portal-relay
sleep 5
systemctl is-active portal-relay
sudo journalctl -u portal-relay -n 5 --no-pager
REMOTE
echo "done: the portal reader runs on $HOST every minute; the Mac steps aside while it does."
