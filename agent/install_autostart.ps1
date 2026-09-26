param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$Room = "test123",
    [ValidateRange(1, 32)][int]$Monitor = 1
)

$ErrorActionPreference = "Stop"
$taskName = "RDP Agent (interactive)"
$configDir = Join-Path $env:APPDATA "RDPAgent"
$configPath = Join-Path $configDir "config.json"
$tokenPath = Join-Path $configDir "token.dpapi"
$venvDir = Join-Path $PSScriptRoot ".venv"
$python = Join-Path $venvDir "Scripts\python.exe"
$pythonw = Join-Path $venvDir "Scripts\pythonw.exe"
$agent = Join-Path $PSScriptRoot "agent_gui.py"
$launcher = Join-Path $PSScriptRoot "start_autostart.ps1"

if ($Server -notmatch '^https?://[^\s]+$') {
    throw "Server must be an http:// or https:// URL."
}
if ([string]::IsNullOrWhiteSpace($Room)) {
    throw "Room cannot be empty."
}
if (-not (Test-Path $agent) -or -not (Test-Path $launcher)) {
    throw "Run this script from the complete, updated agent folder."
}

if (-not (Test-Path $python)) {
    py -3 -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "Could not create Python environment." }
}
& $python -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install agent dependencies." }
if (-not (Test-Path $pythonw)) { throw "pythonw.exe was not found in the Python environment." }

$secureToken = Read-Host "Enter the relay ACCESS_TOKEN" -AsSecureString
if ($secureToken.Length -eq 0) { throw "Access token cannot be empty." }

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$secureToken | ConvertFrom-SecureString | Set-Content -Path $tokenPath -Encoding ASCII
@{
    server = $Server
    room = $Room
    monitor = $Monitor
    pythonw = $pythonw
    agent = $agent
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $launcher
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Auto-start installed for $identity. It starts after Windows sign-in."
Write-Host "The agent window stays visible and can be disconnected or closed locally."
Write-Host "To start it now, sign out and in, or run: Start-ScheduledTask -TaskName '$taskName'"
