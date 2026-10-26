param([switch]$IncludeTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
    }
    $requirements = if ($IncludeTests) { 'requirements-dev.txt' } else { 'requirements.txt' }
    & '.\.venv\Scripts\python.exe' -m pip install --no-index --find-links .\wheelhouse -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Offline install failed; download matching wheels first' }
} finally { Pop-Location }
