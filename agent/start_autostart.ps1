$ErrorActionPreference = "Stop"
$configDir = Join-Path $env:APPDATA "RDPAgent"
try {
    $config = Get-Content (Join-Path $configDir "config.json") -Raw | ConvertFrom-Json
    $secureToken = (Get-Content (Join-Path $configDir "token.dpapi") -Raw).Trim() | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        $env:RDP_AGENT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    $arguments = '"{0}" --autoconnect' -f $config.agent
    Start-Process -FilePath $config.pythonw -ArgumentList $arguments -WorkingDirectory (Split-Path $config.agent)
} catch {
    $_ | Out-File -FilePath (Join-Path $configDir "startup-error.log") -Append
    throw
} finally {
    Remove-Item Env:RDP_AGENT_TOKEN -ErrorAction SilentlyContinue
}
