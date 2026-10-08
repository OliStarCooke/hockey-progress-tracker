# Start the shared hockey progress tracker on localhost via Docker.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's directory.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'Docker is required but was not found. Install Docker Desktop first.'
}

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example — set TRACKED_TEAM_ID to your ESPN team ID, then re-run this script.'
  Write-Host 'Find your team ID in the exported CSV (team_id column) or your ESPN URL.'
  exit 0
}

New-Item -ItemType Directory -Force -Path 'data', '.secrets' | Out-Null
if (-not (Test-Path -LiteralPath '.secrets/espn.env')) {
  New-Item -ItemType File -Path '.secrets/espn.env' | Out-Null
}

# Prefer Compose v2 ("docker compose"), fall back to standalone docker-compose.
& docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  & docker compose up --build -d
} elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
  & docker-compose up --build -d
} else {
  Write-Error 'Docker Compose was not found. Install Docker Desktop first.'
}

$port = '3210'
foreach ($line in (Get-Content -LiteralPath '.env')) {
  if ($line -match '^\s*PORT\s*=\s*(.+?)\s*$') {
    $port = $Matches[1].Trim()
    break
  }
}
Write-Host "Tracker is starting at http://localhost:${port}"
Write-Host 'Follow logs with: docker logs -f hockey-progress-tracker'
