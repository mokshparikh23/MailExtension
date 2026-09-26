# Deploy the visible Windows agent with Group Policy

This lab package installs the agent at user sign-in. It has no configured laptop
count: any future domain-joined laptop in the targeted OU/group receives the
same policy. No one has to run CMD or PowerShell on each laptop. The agent
remains visible and can be disconnected or closed locally. Windows sign-in is
required for desktop capture.

## 1. Update the central relay

Use a relay URL that every site can reach, such as
`https://remote.averisglobalsolution.com`. Update the server from this repo and
set two **different** random values on the server:

- `ACCESS_TOKEN`: controller token, kept with the admins.
- `AGENT_TOKEN`: agent-only token, used in `deployment.json` below.

The current relay falls back to `ACCESS_TOKEN` when `AGENT_TOKEN` is absent for
older single-device setups. Do not use that fallback for the GPO rollout.
Restart the relay after updating its environment. For the native deployment,
these values are in `server/.env` and the service is `irc`. For Docker Compose,
they are in `deploy/.env` and the service is `relay`.

After the update, `https://remote.averisglobalsolution.com/health` should return
`{"ok":true,...}`. The controller's **Refresh devices** button uses
`/api/agents`; its list is available only with `ACCESS_TOKEN`. Search by device
name or room when the list grows. Device names and last-seen times survive
relay restarts in `server/data/devices.json` (native) or the Compose
`device_registry` volume. Back up that file/volume during server migrations.

## 2. Build the Windows executable once

On one Windows build machine, use the latest `agent/` folder and run
`build_windows.ps1`. Take the resulting `agent/dist/netrem.exe`. An executable
built before this GPO package does not include the current `--autoconnect`
behavior or one-instance guard.

## 3. Put three files in the GPO script folder

In Group Policy Management, create a GPO for the authorized lab users. Edit
**User Configuration → Policies → Windows Settings → Scripts (Logon)**, open the
**PowerShell Scripts** tab, and use **Show Files**. Copy these three files into
that folder:

- `Install-NetremAtLogon.ps1` from this directory.
- The newly built `netrem.exe`.
- `deployment.json`, made from `deployment.example.json`.

In `deployment.json`, keep the central HTTPS URL, set `agentToken` to the
server's **AGENT_TOKEN**, and choose a `roomPrefix` such as `lab`. Each laptop
then gets a stable room such as `lab-DESKTOP-9M7FTGI-a1b2c3d4e5f6`. The final
part is derived from that Windows installation's MachineGuid, so repeated
computer names across sites do not collide. Properly generalize cloned Windows
images so they do not share a MachineGuid. Do not put `ACCESS_TOKEN` in this
file. Do not commit `deployment.json` to Git.

Add `Install-NetremAtLogon.ps1` as a PowerShell logon script. Scope the GPO to
the lab user OU or security group. If the GPO is linked only to a computer OU,
configure user-policy loopback processing for that OU. The script copies the
executable to the user's local profile, writes the server/room configuration,
and launches the visible agent. Repeated logons reuse the installed version;
an updated executable gets a new versioned local path.

The agent-only token is readable to users who can read the GPO script folder.
It cannot be used as a controller token when the relay has a separate
`AGENT_TOKEN`, but this package is intended for a trusted lab domain. Use
per-device enrollment and stronger access controls before a wider rollout.

## 4. Pilot, then expand

Sign in to one lab laptop. It should open `netrem` and show its room. On the
controller website, enter the admin `ACCESS_TOKEN`, click **Refresh devices**,
select that laptop, and click **Connect**. If installation fails, read
`%LOCALAPPDATA%\AverisNetrem\gpo-install-error.log` on the laptop.

After the pilot works, apply the GPO to a small group, then the full lab OU or
security group. New laptops receive it automatically after joining that scope
and signing in. To update all agents later, replace the one `netrem.exe` in the
GPO folder; each laptop copies the new version at its next sign-in. Remove the
GPO assignment to stop launching new agents at sign-in; existing agents stop
when their user signs out or closes the window.

The relay still runs as one server instance. The number of laptops is not fixed
in the GPO or device list, but simultaneous screen sessions consume server
bandwidth and memory. Test capacity against your expected concurrent viewers
before a large rollout. Multiple relay instances would require a shared room
store and Socket.IO adapter; the local device registry is for one instance.

Wake-on-LAN across separate sites is a separate feature. It needs an awake
sender on each site's local network. The relay's single `WAKE_MAC` setting is
for the earlier one-laptop test and does not wake all 50 laptops.
