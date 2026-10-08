#!/usr/bin/env bash
set -euo pipefail
tracker_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tracker_node="$(command -v node)"
tracker_units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
cd "$tracker_root"
npm run build
mkdir -p "$tracker_units"
cat > "$tracker_units/progress-tracker.service" <<UNIT
[Unit]
Description=Hockey pool progress tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$tracker_root
ExecStart="$tracker_node" "$tracker_root/node_modules/tsx/dist/cli.mjs" "$tracker_root/server/index.ts"
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3210
EnvironmentFile=-$tracker_root/.env
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now progress-tracker.service
systemctl --user --no-pager status progress-tracker.service
