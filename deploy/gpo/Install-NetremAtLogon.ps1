# Assign as a User Configuration > Windows Settings > Scripts (Logon)
# PowerShell script in the lab GPO. netrem.exe and deployment.json must be in
# this script's folder in SYSVOL. Nothing is run manually on client laptops.

$ErrorActionPreference = "Stop"
$localRoot = Join-Path $env:LOCALAPPDATA "AverisNetrem"
$configRoot = Join-Path $env:APPDATA "RDPAgent"

try {
    $sourceExe = Join-Path $PSScriptRoot "netrem.exe"
    $sourceConfig = Join-Path $PSScriptRoot "deployment.json"
    if (-not (Test-Path $sourceExe) -or -not (Test-Path $sourceConfig)) {
        throw "netrem.exe and deployment.json must be next to this GPO script."
    }

    $settings = Get-Content $sourceConfig -Raw | ConvertFrom-Json
    $server = [string]$settings.server
    $agentToken = [string]$settings.agentToken
    $roomPrefix = [string]$settings.roomPrefix
    $monitor = [int]$settings.monitor
    if ($server -notmatch '^https://[^\s]+$') { throw "A central HTTPS server URL is required." }
    if ($agentToken.Length -lt 16 -or $agentToken -eq "REPLACE_WITH_AGENT_TOKEN") {
        throw "Set a separate AGENT_TOKEN in deployment.json."
    }
    if ($roomPrefix -notmatch '^[A-Za-z0-9_-]{1,24}$') {
        throw "roomPrefix must contain 1-24 letters, numbers, _ or -."
    }
    if ($monitor -lt 1 -or $monitor -gt 32) { throw "monitor must be between 1 and 32." }

    # MachineGuid keeps the room unique across sites/domains with repeated hostnames.
    $machineGuid = [string](Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid).MachineGuid
    if (-not $machineGuid) { throw "Windows MachineGuid is unavailable." }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $guidBytes = [Text.Encoding]::UTF8.GetBytes($machineGuid.ToLowerInvariant())
        $deviceId = [BitConverter]::ToString($sha256.ComputeHash($guidBytes)).Replace("-", "").Substring(0, 12).ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    $room = "$roomPrefix-$env:COMPUTERNAME-$deviceId".ToLowerInvariant()
    $version = (Get-FileHash $sourceExe -Algorithm SHA256).Hash.Substring(0, 12)
    $versionDir = Join-Path $localRoot "versions\$version"
    $installedExe = Join-Path $versionDir "netrem.exe"
    New-Item -ItemType Directory -Path $versionDir, $configRoot -Force | Out-Null
    if (-not (Test-Path $installedExe)) {
        Copy-Item $sourceExe $installedExe
    }

    @{
        server = $server
        room = $room
        monitor = $monitor
    } | ConvertTo-Json | Set-Content (Join-Path $configRoot "config.json") -Encoding UTF8

    $env:RDP_AGENT_TOKEN = $agentToken
    Start-Process -FilePath $installedExe -ArgumentList "--autoconnect" -WorkingDirectory $versionDir
} catch {
    New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
    $_ | Out-File (Join-Path $localRoot "gpo-install-error.log") -Append
    exit 1
} finally {
    Remove-Item Env:RDP_AGENT_TOKEN -ErrorAction SilentlyContinue
}
