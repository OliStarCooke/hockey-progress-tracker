#!/usr/bin/env bash
# Start the shared hockey progress tracker on localhost via Docker.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found. Install Docker Desktop or docker engine first." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — set TRACKED_TEAM_ID to your ESPN team ID, then re-run this script."
  echo "Find your team ID in the exported CSV (team_id column) or your ESPN URL."
  exit 0
fi

mkdir -p data .secrets
touch .secrets/espn.env 2>/dev/null || true

if docker compose version >/dev/null 2>&1; then
  docker compose up --build -d
else
  docker-compose up --build -d
fi

port="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]')"
port="${port:-3210}"
echo "Tracker is starting at http://localhost:${port}"
echo "Follow logs with: docker logs -f hockey-progress-tracker"
