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
- Open **Settings** and click **Connect**. The settings panel closes so the remote screen fills the page.
- Live share and mouse control start enabled. Use **Fullscreen** for the largest view.

## Two-Laptop Test on the Same Network

Run the server on Laptop A. Find Laptop A's local IP address, then open the controller on Laptop A at `http://localhost:3000` (or `http://<laptop-a-ip>:3000` from another device).

Copy the current `agent/` folder to Laptop B. On Laptop B, install or update its dependencies and start the agent:

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python agent.py --server http://<laptop-a-ip>:3000 --room test123 --token replace-with-a-long-random-token
```

Use the same token and room ID in the controller's Settings. On macOS, allow Screen Recording and Accessibility for the app running the agent, then restart the agent. When updating from an earlier version, copy the updated `agent.py` and `requirements.txt` to Laptop B (or unpack [`agent-update.zip`](agent-update.zip)), rerun `pip install -r requirements.txt`, and restart the agent. The CLI agent sends resized JPEG full and delta frames and applies click coordinates in a single event, which reduces visible delay.

## Avoid Mirror Recursion

If the agent captures the same display where the browser controller is open, you will see an infinite mirror/tunnel effect. For a realistic lab test:

- Run the agent on a second machine, VM, or cloud desktop.
- Or put the controller on monitor 1 and the tested MSB/lab screen on monitor 2, then set the agent monitor number to `2`.
- Or use a VM display as the captured target and keep the browser controller outside the VM.

## Windows Capture Protection Demo

To see why a protected window can be blank in the remote viewer, copy the demo
script with the `agent/` folder and run it on Laptop B (Windows) while the agent
and browser controller are connected:

```powershell
cd agent
py capture_protection_demo.py
```

Use **Exclude from capture** and **Allow capture** in the demo window, then
compare Laptop B's display with the browser viewer on Laptop A. The toggle uses
Windows `SetWindowDisplayAffinity` on the demo's own window. It does not change
other apps or Windows permission prompts. If the demo is excluded, use Laptop B's
own screen to click **Allow capture**.

Windows 10 version 2004 or later is needed for `WDA_EXCLUDEFROMCAPTURE`. The
result in a given capture tool may be a blank area or the window disappearing.

## Start the Windows Agent Automatically

On Laptop B, stop any manually running agent, then open PowerShell in the
updated `agent/` folder and run this once:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install_autostart.ps1 -Server "http://<laptop-a-ip>:3000" -Room "test123"
```

Enter the relay access token when prompted. The script installs Python
dependencies and a per-user Windows Scheduled Task. After each Windows sign-in,
the task opens the visible agent GUI without a CMD window and connects it to the
relay. The agent retries if the relay is temporarily unavailable. To start it
immediately after installation, run:

```powershell
Start-ScheduledTask -TaskName "RDP Agent (interactive)"
```

You can disconnect or close the agent window on Laptop B at any time. To remove
auto-start, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall_autostart.ps1`
from the agent folder. The token is
stored for the current Windows user with Windows DPAPI, while server, room, and
monitor settings are stored under `%APPDATA%\RDPAgent`.

This starts after **sign-in**, because desktop capture and mouse control need
the interactive Windows session. Laptop A's relay must also be running and
reachable. Windows lock and UAC secure desktop screens remain unavailable to the
agent.

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
