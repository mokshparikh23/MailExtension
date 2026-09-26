# Internal Remote Control

This is a consent-based internal remote-control MVP for agency lab testing and support. It has two parts:

- `server/`: Node.js + Express + Socket.IO relay and browser controller.
- `agent/`: Python device agent that a user starts manually on the device being shared.

The design intentionally requires an explicit room ID and shared token. The agent prints a visible notice and can be stopped with `Ctrl+C`.

## Local Run

Terminal 1:

```bash
cd server
npm install
ACCESS_TOKEN="replace-with-a-long-random-token" npm start
```

Open:

```text
http://localhost:3000
```

Terminal 2:

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python agent.py --server http://localhost:3000 --room test123 --token replace-with-a-long-random-token
```

In the browser controller:

- Server token: `replace-with-a-long-random-token`
- Room ID: `test123`
- Click `Connect`
- Click `Get Screen`

## AWS Deployment

Recommended simple deployment:

1. Create an EC2 Ubuntu instance.
2. Open inbound `80` and `443` only.
3. Install Node.js 20 and Nginx.
4. Copy the `server/` folder to `/opt/internal-remote-control`.
5. Run:

```bash
cd /opt/internal-remote-control
npm ci --omit=dev
ACCESS_TOKEN="use-a-long-random-secret" PORT=3000 npm start
```

For production, run the server with `pm2` or `systemd`, and put Nginx in front with TLS.

Example Nginx reverse proxy:

```nginx
server {
    server_name remote.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then run the agent with:

```bash
python agent.py --server https://remote.yourdomain.com --room test123 --token use-a-long-random-secret
```

## Security Notes

- Use this only on devices you own or where the user has explicitly consented.
- Put it behind VPN, Tailscale, or a Zero Trust gateway before real internal use.
- Replace the shared token with your SSO/auth layer before broader rollout.
- Log sessions and require short-lived room codes for production.
- Do not expose this publicly without TLS, authentication, rate limits, and auditing.
