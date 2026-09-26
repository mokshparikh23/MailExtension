#!/usr/bin/env bash
#
# One-shot provisioning for a fresh Ubuntu 22.04/24.04 EC2 instance.
# Native (non-Docker) path: Node 20 + Nginx + Let's Encrypt TLS + systemd.
#
# Prereq: clone this repo to /opt/internal-remote-control on the server,
#         and point an A record  remote.<yourdomain> -> this instance's Elastic IP
#         BEFORE running (certbot needs DNS to already resolve).
#
# Usage:
#   sudo DOMAIN=remote.yourdomain.com \
#        ACCESS_TOKEN="$(openssl rand -hex 32)" \
#        EMAIL=you@yourdomain.com \
#        bash /opt/internal-remote-control/deploy/deploy.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN, e.g. remote.yourdomain.com}"
ACCESS_TOKEN="${ACCESS_TOKEN:?set a long random ACCESS_TOKEN (e.g. openssl rand -hex 32)}"
EMAIL="${EMAIL:?set EMAIL for Let's Encrypt notices}"
APP_DIR="${APP_DIR:-/opt/internal-remote-control}"

echo ">> Installing Node.js 20, Nginx, certbot"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx

echo ">> Installing server dependencies"
cd "$APP_DIR/server"
npm ci --omit=dev

echo ">> Writing environment file"
cat > "$APP_DIR/server/.env" <<EOF
PORT=3000
ACCESS_TOKEN=$ACCESS_TOKEN
CORS_ORIGIN=https://$DOMAIN
EOF
chmod 600 "$APP_DIR/server/.env"
chown -R www-data:www-data "$APP_DIR/server"

echo ">> Installing systemd service"
cp "$APP_DIR/deploy/irc.service" /etc/systemd/system/irc.service
systemctl daemon-reload
systemctl enable --now irc

echo ">> Configuring Nginx for $DOMAIN"
sed "s/remote.example.com/$DOMAIN/g" "$APP_DIR/deploy/nginx-remote.conf" \
  > /etc/nginx/sites-available/irc
ln -sf /etc/nginx/sites-available/irc /etc/nginx/sites-enabled/irc
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ">> Requesting TLS certificate"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo ">> Done. Controller UI:  https://$DOMAIN"
echo ">> Health check:         curl https://$DOMAIN/health"
echo ">> Point the agent at:   --server https://$DOMAIN --token <ACCESS_TOKEN>"
echo ">> Service logs:         journalctl -u irc -f"
