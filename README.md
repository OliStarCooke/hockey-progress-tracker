# Progress Tracker (shared edition)

A self-hosted tracker for the hockey pool's season points. React and TypeScript, shadcn/ui controls, Recharts, and an Express service backed by SQLite. All ESPN requests happen on the server.

Each person sets their own default team with `TRACKED_TEAM_ID`. There is no Shadow team in this edition.

Open **http://localhost:3210**. The service syncs with ESPN every **5 minutes** by default, even when the browser is closed. Set `SYNC_INTERVAL_MINUTES` (1–1440) to change that. On startup it syncs only if the last attempt is at least one interval old. Manual sync remains available and postpones the next automatic sync. The page refreshes its data every 30 seconds.

ESPN's official team totals cover completed scoring days. For live scores, each sync also reads the current day's actual player stats and adds points and GP from active capped slots to those official totals. Bench points are excluded, as are roles that had already reached their season cap before the day began. These totals are provisional and may change after corrections. Daily view, standings and summary totals include the live snapshot; form, role breakdowns and outlook still use completed days.

**Live polling does not accumulate SQLite history.** A single metadata row holds the latest live snapshot and is replaced on each successful refresh. It survives restarts and is cleared when ESPN advances the scoring day. Only changes in official totals, GP or scoring period create historical captures. Completed role days use fixed rows per team and slot. Raw ESPN responses are not stored. The NHL schedule refreshes once a day. Each ordinary sync costs one small team/settings request plus one current-day roster request (about 1.6 MB); that response is processed and discarded. If live scoring fails, the page warns and keeps the last live snapshot for the same scoring day.

Use the top-right light/dark toggle to change the appearance. The first visit follows your system preference; your choice is saved for future visits. Both themes use the same tracking data and controls.

## Explore the league

- Your tracked team (`TRACKED_TEAM_ID`) is highlighted as **YOU**, used for the summary cards, and is the default differential baseline and chart highlight. Show or hide any team, search names, or focus on your team. Visibility and the comparison baseline persist in your browser (key `progress-tracker:v2`).
- Switch between cumulative points, points per game, 7-day form, point changes, differential against any team, and league rank. Ranks use the full league, regardless of hidden teams; ties share a rank.
- Track points per game (Pts / GP), the metric that decides a capped-games league. GP is ESPN's count of games played in active lineup slots (stat 30), the same counter the positional season caps limit. The standings show GP, Pts / GP and **form**: points per game over the last 7 completed scoring days. Your team's cards show its rate, its rank by rate, its pace, its odds of winning, and its points and GP on the last completed day.
- Choose daily or every capture. Daily view uses completed ESPN scoring days and the provisional current day (see below); every capture shows each change observed in ESPN's official totals plus the latest provisional live snapshot. Form always uses scoring days. Hover the graph for exact values.
- Use the full tracked season, last 7 or 30 days, or custom dates.
- Sort the standings by rank, name, points, GP, Pts / GP, form, range change, or differential. Standings reflect the end of the selected range; summary cards show the latest league data.
- **Points per game by role** breaks each team's season down by lineup slot: forwards (F), defense (D), goalies (G) and utility (UTIL), each with its own season games cap. Points and games count only while a player fills that slot. Each cell shows points per game, league rank, points, GP and **cap pace**: GP compared with an even share of the cap, where the share is the fraction of the NHL schedule's games already played. Within 10% of that target (at least one game) counts as on pace. The **bench** column shows points scored by benched players; with games caps, some benching is deliberate. Click a heading to sort.
- **Season outlook** shows each team's official points, **pace** and simulated finish. Pace is each role's points per game × its remaining capped games, using the league rate for roles a team has not played yet. The simulation runs 4,000 seasons, assuming every team fills its remaining caps. Each role's true rate blends the team's games with 25 games at the league rate and is itself uncertain; game-to-game noise uses each role's observed spread. It reports the median and 10th–90th percentile final totals and the chances of finishing first or in the top 3. The odds are estimates from a simple model: they ignore injuries, trades, schedules and lineup decisions, and they are not calibrated.
- Export historical official observations as CSV, including team IDs so duplicate abbreviations stay distinct, and games played when known.

**Daily history comes from completed scoring days.** ESPN does not publish per-slot or past daily team scores, so on each sync the service downloads every completed scoring day's lineups it does not have yet (one `mRoster` request per day, about 1.6 MB) and sums each team's capped slots and bench. It keeps the result only if the capped slots add up exactly to ESPN's official team points and GP. A stat correction triggers a refetch of the last 7 days, then the whole season if needed. If the sums still don't match, the dashboard shows a warning and keeps the last data that did; point totals are still saved. The NHL schedule (public, refreshed once a day) supplies each scoring day's date (day 1 is September 29, 2026) and the games used for cap pace. The completed-day history gains the current day after ESPN finalizes it; the provisional live snapshot is kept separately.

In Daily view, point change is the points scored on each scoring day. Without scoring-day data, Daily view falls back to the last capture of each **America/Montreal** calendar day, and a change can then span missing days. Every capture compares consecutive official captures and the latest live snapshot. Live changes between polls are not archived. Range change is the last total minus the first total in the selected range, and is unavailable for a single observation. ESPN corrections can produce negative changes.

## Run with Docker (recommended for sharing)

Requires **Docker** with Compose v2.

```bash
cp .env.example .env
# Edit .env: set TRACKED_TEAM_ID to your ESPN team ID,
# plus ESPN_LEAGUE_ID / ESPN_SEASON / ESPN_SECRETS_PATH as needed.
bash scripts/start-docker.sh
# Open http://localhost:3210
```

On Windows (PowerShell):

```powershell
Copy-Item .env.example .env
# Edit .env: set TRACKED_TEAM_ID to your ESPN team ID, then:
.\scripts\Start-Docker.ps1
# Open http://localhost:3210
```

This builds the app image, starts the container, and keeps history in the `tracker-data` Docker volume. Logs: `docker logs -f hockey-progress-tracker`. Stop: `docker compose down`. Your `.env`, `data/`, and `.secrets/` stay on the host and are gitignored.

Private leagues need ESPN cookies in `.secrets/espn.env` (mounted read-only):

```dotenv
espn_s2=...
SWID=...
```

Public leagues can leave that file empty or remove the secrets volume line from `docker-compose.yml`. Cookies never leave the server.

## Run locally without Docker

Requires **Node.js 22.13+** (SQLite support) and npm. Node 26 was used to build and verify this project.

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

For development, `npm run dev` runs the API and Vite with hot reload on the same port. Use `PORT=3211 npm run dev` if port 3210 is taken.

Configuration lives in `.env` (gitignored); see [.env.example](.env.example). Key values:

| Variable | Meaning |
|---|---|
| `ESPN_LEAGUE_ID` / `ESPN_SEASON` | League to track (default `918256829` / `2027`) |
| `TRACKED_TEAM_ID` | Your ESPN team ID; highlighted as YOU (example: Astra is `3`) |
| `SYNC_INTERVAL_MINUTES` | Auto-sync cadence, 1–1440 |
| `ESPN_SECRETS_PATH` | Cookies file for private leagues |
| `DATA_DIR` | SQLite directory (each league+season gets its own file) |

Each league and season gets its own SQLite database under `data/`.

## Keep it running (systemd alternative)

The installation script builds the app and enables a systemd **user** service:

```bash
npm run service:install
systemctl --user status progress-tracker
journalctl --user -u progress-tracker -f
systemctl --user restart progress-tracker
systemctl --user stop progress-tracker
```

The service listens on `127.0.0.1:3210` (see below for phone access), restarts on failure, and starts with the user manager. For boot persistence without login, check `loginctl show-user "$USER" -p Linger`; enabling lingering is a separate host administration step.

### Open it on your phone

By default the service only accepts connections from this computer. To use it from other devices on your home Wi-Fi, set in `.env` and restart:

```dotenv
HOST=0.0.0.0
ALLOWED_CLIENTS=192.168.0.0/24
```

Then open `http://<this computer's Wi-Fi IP>:3210` on a device on the same Wi-Fi (`ip -4 addr show wlan0` shows the IP). `ALLOWED_CLIENTS` lists the subnets allowed to connect, separated by commas; this computer itself is always allowed. There is no login: anyone on an allowed network can see the league data, export the CSV and trigger a sync (at most one ESPN request per minute). ESPN cookies never leave the server.

After changes, run `npm run build` and `systemctl --user restart progress-tracker`. To remove the service, run `systemctl --user disable --now progress-tracker`; the local data stays intact.

If ESPN fails or authentication expires, the dashboard displays the error alongside the last saved data and the service retries at the next collection interval. Manual sync coalesces concurrent requests and avoids repeated requests within one minute of a successful capture.

## Data and backups

History is stored in `data/<league>-<season>.sqlite` (for example `data/918256829-2027.sqlite`). The database, credentials, build output, and dependencies are gitignored. To back up the database, stop the container/service, copy the `data/` directory (or `docker volume` contents), then start again. Keep the directory when upgrading; deleting it deletes recorded history. An offline machine cannot capture missed days. Original archived `mTeam.json` captures can be imported with `npm run backfill -- /path/to/mTeam.json [...]`. Preserve the original file modification time: it supplies the capture timestamp. The importer checks league, season, complete team IDs, and timestamps; imports are atomic, skip existing timestamps, and preserve current names and sync metadata. It only imports captures earlier than existing history; for a capture already stored, it only adds missing games played and never changes recorded points. Pass matching environment variables when running this command directly if using another league or data directory.

## Verify

```bash
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests default to the production service at port 3210; set `TRACKER_TEST_URL` to test another instance. One test uses an explicitly mocked multi-day league to exercise controls; another checks the live dashboard on desktop and mobile. Unit tests cover persistence, migrations, transaction rollback, duplicate abbreviations, midnight boundaries, ranking ties, negative corrections, ESPN response validation, scoring-day reconciliation, the NHL schedule, form, cap pace, role pace and the seeded season simulation.

The bundled fonts (DM Sans and Manrope) are served locally and include their SIL Open Font License files in `public/fonts/`.
