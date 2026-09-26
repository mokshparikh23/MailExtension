# Deploy

Deploy artifacts for the **relay server** (`../server`). The Python agent is not
deployed here — it runs on whatever device you want to share, pointed at the
server URL below.

Two paths are provided. Pick one.

---

## DNS (do this first, on your own domain)

The server needs a hostname with TLS. On **your domain's DNS** (NOT zaven.com —
its DNS is at Hetzner), add one record:

| Type | Name / Host        | Value                        | TTL |
|------|--------------------|------------------------------|-----|
| A    | `remote`           | `<EC2 Elastic IP>`           | 300 |

That publishes `remote.yourdomain.com -> <your EC2 Elastic IP>`. Fill in the
Elastic IP after you create the EC2 instance. Wait until it resolves
(`dig +short remote.yourdomain.com`) before running certbot.

---

## Path A — Native (Node + systemd + Nginx)

On a fresh Ubuntu 22.04/24.04 EC2 instance (Security Group inbound: 80, 443, and
22 from your IP only):

```bash
sudo mkdir -p /opt && sudo git clone <this-repo-url> /opt/internal-remote-control
sudo DOMAIN=remote.yourdomain.com \
     ACCESS_TOKEN="$(openssl rand -hex 32)" \
     EMAIL=you@yourdomain.com \
     bash /opt/internal-remote-control/deploy/deploy.sh
```

`deploy.sh` installs Node 20 + Nginx + certbot, writes `server/.env`, starts the
`irc` systemd service, configures the reverse proxy, and gets a TLS cert.

Manage it:

```bash
systemctl status irc
journalctl -u irc -f
```

## Path B — Docker

On the instance (Docker + docker compose installed), still terminate TLS with
Nginx + certbot on the host (see `nginx-remote.conf`), then:

```bash
cd /opt/internal-remote-control/deploy
cat > .env <<EOF
ACCESS_TOKEN=$(openssl rand -hex 32)
CORS_ORIGIN=https://remote.yourdomain.com
EOF
docker compose up -d --build
```

The container binds to `127.0.0.1:3000`; Nginx proxies `remote.yourdomain.com`
to it.

---

## After deploy

```bash
curl https://remote.yourdomain.com/health      # {"ok":true,...}
```

Point the agent (on the device being shared) at it:

```bash
python agent.py --server https://remote.yourdomain.com --room test123 --token <ACCESS_TOKEN>
```

Open `https://remote.yourdomain.com` in a browser, enter the token + room, Connect.

---

## Before real / public use — read this

- **Shared static token only.** Anyone with the token + room can view and control
  any connected agent. Fine behind VPN; for broader use add real per-session auth
  and short-lived room codes.
- Keep it behind **VPN / Tailscale / Zero Trust** for internal use — then you
  don't even need 80/443 open to the whole internet.
- No rate limits or audit logging yet. Add both before exposing publicly.
- Rotate `ACCESS_TOKEN` if it is ever shared or logged.
