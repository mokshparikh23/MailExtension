# RDP / netrem-style Internal Remote Control

This is a consent-based internal remote-control MVP for agency lab testing and support. It has two parts:

- `server/`: Node.js + Express + Socket.IO relay and browser controller.
- `agent/`: Python device agent and compact GUI agent for the device being shared.

The design intentionally requires an explicit room ID and shared token. The agent prints a visible notice and can be stopped with `Ctrl+C`.

## What It Includes

- Browser controller with room pairing.
- Compact `netrem`-style desktop agent UI.
- Socket.IO relay.
- Mouse click, scroll, and keyboard forwarding.
- Live screenshot sharing.
- `FULL`, `DELTA`, and `No Change` frame types.
- Device name, agent version, screenshot size, and frame type overlays.
- Monitor selection to avoid mirror-recursion during local testing.
- macOS and Windows packaging scripts.

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

Or run the GUI agent:

```bash
cd agent
source .venv/bin/activate
python agent_gui.py
```

In the GUI, enter:

- Server URL: `http://localhost:3000`
- Room ID: `test123`
- Access Token: `replace-with-a-long-random-token`
- Monitor number: `1`

Then click `Connect`. The browser controller should show the agent as online.

In the browser controller:

- Server token: `replace-with-a-long-random-token`
- Room ID: `test123`
- Click `Connect`
- Click `Get Screen`

## Avoid Mirror Recursion

If the agent captures the same display where the browser controller is open, you will see an infinite mirror/tunnel effect. For a realistic lab test:

- Run the agent on a second machine, VM, or cloud desktop.
- Or put the controller on monitor 1 and the tested MSB/lab screen on monitor 2, then set the agent monitor number to `2`.
- Or use a VM display as the captured target and keep the browser controller outside the VM.

## Build Desktop Agent

macOS:

```bash
cd agent
chmod +x build_macos.sh
./build_macos.sh
open dist/netrem.app
```

Windows PowerShell:

```powershell
cd agent
.\build_windows.ps1
.\dist\netrem.exe
```

The packaged app is a visible lab agent. It is not hidden and does not include stealth or evasion behavior.

## End-to-End MSB Lab Test

1. Deploy or run the `server/` relay.
2. Open the browser controller from your operator machine.
3. Start `netrem` agent on the authorized lab/MSB test machine.
4. Use the same room ID and access token on both sides.
5. In your MSB, observe whether it detects:
   - screen capture activity
   - accessibility/input-control permission
   - suspicious process presence
   - outbound Socket.IO/WebSocket traffic
   - remote mouse/keyboard pattern
   - display mirroring or virtual machine indicators
6. Record which controls were enabled, frame type, frame size, and whether MSB raised alerts.

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
- This project is for authorized defensive testing. It does not include stealth, detection bypass, or proctoring-evasion features.
