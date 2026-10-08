import express from "express";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { Store } from "./store.ts";
import {
  BENCH_SLOT,
  espnSecretsStatus,
  fetchEspn,
  fetchRoleDay,
  fetchSchedule,
} from "./espn.ts";
import { reconcileRoles, roleSummary } from "./roles.ts";
import { clientFilter } from "./network.ts";
import { collectLive } from "./live.ts";
import { syncDelay } from "./schedule.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `npm start` / `npm run dev` do not load .env on their own (Docker passes env
// directly), so read the repo-local file when present. Real env vars win.
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const integer = z.coerce.number().int().positive();
const port = integer.max(65535).parse(process.env.PORT ?? 3210);
const leagueId = integer.parse(process.env.ESPN_LEAGUE_ID ?? 918256829);
const season = integer.parse(process.env.ESPN_SEASON ?? 2027);
// Default highlighted team. Colleagues set this to their own ESPN team ID;
// the UI still lets anyone change baseline/focus afterwards.
const trackedTeamId =
  process.env.TRACKED_TEAM_ID?.trim() === "" ||
  process.env.TRACKED_TEAM_ID === undefined
    ? null
    : integer.parse(process.env.TRACKED_TEAM_ID);
const intervalMinutes = z.coerce
  .number()
  .min(1)
  .max(1440)
  .parse(process.env.SYNC_INTERVAL_MINUTES ?? 5);
const secretsPath = resolve(
  root,
  process.env.ESPN_SECRETS_PATH ?? ".secrets/espn.env",
);
const store = new Store(
  resolve(root, process.env.DATA_DIR ?? "data", `${leagueId}-${season}.sqlite`),
);
let inFlight: Promise<void> | null = null;
async function collect(trigger: "manual" | "scheduled") {
  const timestamp = new Date().toISOString();
  store.setMeta("lastAttempt", timestamp);
  try {
    const data = await fetchEspn(leagueId, season, secretsPath);
    const knownIds = store.teams().map((team) => team.id);
    if (knownIds.some((id) => !data.teams.some((team) => team.id === id)))
      throw new Error(
        "ESPN returned an incomplete team list. Existing history has been preserved.",
      );
    const changed = store.save(
      data.teams,
      data.scoringPeriodId,
      timestamp,
      data.gamesCap,
    );
    store.setMeta("error", "");
    console.log(
      `${timestamp} Collected ${data.teams.length} teams (period ${data.scoringPeriodId}, ${trigger})${changed ? "" : "; totals unchanged"}`,
    );
    await collectRoles(data);
    try {
      if (store.meta("rolesError"))
        throw new Error(
          "Live scores need a reconciled completed-day baseline.",
        );
      await collectLive(store, data, timestamp, (period, slots) =>
        fetchRoleDay(leagueId, season, secretsPath, period, slots),
      );
      store.setMeta("liveError", "");
    } catch (error) {
      store.setMeta(
        "liveError",
        error instanceof Error ? error.message : "Live scoring sync failed.",
      );
      console.error(`Live scoring: ${store.meta("liveError")}`);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ESPN sync failed.";
    store.setMeta("error", message);
    console.error(`${timestamp} ${message}`);
    throw new Error(message);
  }
}
// Role breakdowns are secondary: a failure keeps the saved totals and the last reconciled breakdown.
async function collectRoles(data: Awaited<ReturnType<typeof fetchEspn>>) {
  try {
    // The NHL schedule rarely changes; refresh it once a day.
    const fetched = store.meta("scheduleFetched");
    if (
      !store.meta("schedule") ||
      !fetched ||
      Date.now() - Date.parse(fetched) >= 86_400_000
    ) {
      store.setMeta(
        "schedule",
        JSON.stringify(await fetchSchedule(season, secretsPath)),
      );
      store.setMeta("scheduleFetched", new Date().toISOString());
    }
    const capped = Object.keys(data.slotCaps).map(Number);
    if (!capped.length)
      throw new Error("ESPN did not report positional games caps.");
    store.setMeta("slotCaps", JSON.stringify(data.slotCaps));
    const days = await reconcileRoles({
      stored: store.roleDays(),
      current: data.scoringPeriodId,
      totals: new Map(
        data.teams.map((team) => [
          team.id,
          { points: team.points, games: team.games },
        ]),
      ),
      capped,
      fetchDay: (period) =>
        fetchRoleDay(leagueId, season, secretsPath, period, [
          ...capped,
          BENCH_SLOT,
        ]),
    });
    if (days.length) store.saveRoleDays(days);
    store.setMeta("rolesError", "");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Role breakdown sync failed.";
    store.setMeta("rolesError", message);
    console.error(`Role breakdown: ${message}`);
  }
}
function sync(trigger: "manual" | "scheduled") {
  if (!inFlight)
    inFlight = collect(trigger).finally(() => {
      inFlight = null;
    });
  return inFlight;
}
const scheduleSchema = z.object({
  start: z.string(),
  finalPeriod: z.number().int(),
  nhlGames: z.record(z.string(), z.number()),
});
function roleData() {
  const caps = z
    .record(z.string(), z.number())
    .catch({})
    .parse(JSON.parse(store.meta("slotCaps") ?? "{}"));
  return {
    ...roleSummary(store.roleDays(), Object.keys(caps).map(Number)),
    caps,
  };
}
const isAllowedClient = clientFilter(
  (process.env.ALLOWED_CLIENTS ?? "")
    .split(",")
    .map((subnet) => subnet.trim())
    .filter(Boolean),
);
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (isAllowedClient(req.socket.remoteAddress)) {
    next();
    return;
  }
  res.status(403).type("text").send("This device is not allowed.");
});
app.get("/api/dashboard", (_req, res) => {
  const live = store.liveObservation();
  res.json({
    leagueId,
    season,
    trackedTeamId,
    intervalMinutes,
    gamesCap: Number(store.meta("gamesCap")) || null,
    teams: store.teams(),
    observations: [...store.observations(), ...(live ? [live] : [])],
    live,
    liveError: store.meta("liveError") || null,
    roles: roleData(),
    schedule: scheduleSchema
      .nullable()
      .catch(null)
      .parse(JSON.parse(store.meta("schedule") ?? "null")),
    rolesError: store.meta("rolesError") || null,
    lastAttempt: store.meta("lastAttempt"),
    lastSuccess: store.meta("lastSuccess"),
    error: store.meta("error") || null,
  });
});
// Reject cross-origin writes to the local service; credentials stay server-side.
app.post("/api/sync", async (req, res) => {
  const origin = req.get("origin");
  if (origin && origin !== `http://${req.get("host")}`) {
    res.status(403).json({ error: "Cross-origin sync is disabled." });
    return;
  }
  const success = store.meta("lastSuccess");
  if (!inFlight && success && Date.now() - Date.parse(success) < 60_000) {
    res.json({ ok: true });
    return;
  }
  try {
    await sync("manual");
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: store.meta("error") });
  }
});
app.get("/api/export.csv", (_req, res) => {
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const lines = [
    "timestamp,scoring_period,team_id,team_name,abbreviation,total_points,games_played",
  ];
  for (const row of store.observations())
    for (const team of store.teams()) {
      const points = row.points[team.id];
      if (points !== undefined)
        lines.push(
          [
            row.timestamp,
            row.period,
            team.id,
            team.name,
            team.abbrev,
            points,
            row.games[team.id] ?? "",
          ]
            .map(escape)
            .join(","),
        );
    }
  res
    .type("text/csv")
    .attachment(`progress-${season}.csv`)
    .send(lines.join("\n"));
});
app.get("/api/health", (_req, res) =>
  res.json({
    status: store.meta("error") || store.meta("liveError") ? "degraded" : "ok",
    lastSuccess: store.meta("lastSuccess"),
  }),
);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Unknown API route" });
});
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
}
const server = app.listen(port, process.env.HOST ?? "127.0.0.1", async () => {
  console.log(`Progress tracker: http://localhost:${port}`);
  console.log(`ESPN cookies: ${await espnSecretsStatus(secretsPath)}`);
});
let timer: ReturnType<typeof setTimeout>;
let stopping = false;
function schedule() {
  if (stopping) return;
  const delay = syncDelay(store.meta("lastAttempt"), intervalMinutes);
  timer = setTimeout(() => {
    // Manual syncs also postpone the next automatic request.
    if (syncDelay(store.meta("lastAttempt"), intervalMinutes) > 0) {
      schedule();
      return;
    }
    void sync("scheduled")
      .catch(() => {})
      .finally(schedule);
  }, delay);
}
schedule();
function shutdown() {
  stopping = true;
  clearTimeout(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
