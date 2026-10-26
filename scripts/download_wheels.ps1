param([switch]$IncludeTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $requirements = if ($IncludeTests) { 'requirements-dev.txt' } else { 'requirements.txt' }
    python -m pip download --only-binary=:all: --dest wheelhouse -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Wheel download failed' }
    Write-Host 'Copy this project and wheelhouse to the offline machine.'
} finally { Pop-Location }
