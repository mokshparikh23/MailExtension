$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pyinstaller --onefile --windowed --name netrem agent_gui.py

Write-Host "Built Windows executable at: agent\dist\netrem.exe"
