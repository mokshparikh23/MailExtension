$ErrorActionPreference = "Stop"
$taskName = "RDP Agent (interactive)"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$configDir = Join-Path $env:APPDATA "RDPAgent"
if (Test-Path $configDir) {
    Remove-Item $configDir -Recurse -Force
}

Write-Host "Auto-start removed. Close the currently running agent window if it is open."
