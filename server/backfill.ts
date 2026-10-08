import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `npm run backfill` does not load .env on its own, so read the repo-local
// file when present. Real env vars win.
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const integer = z.coerce.number().int().positive();
const leagueId = integer.parse(process.env.ESPN_LEAGUE_ID ?? 918256829);
const season = integer.parse(process.env.ESPN_SEASON ?? 2027);
const files = process.argv.slice(2);
if (!files.length)
  throw new Error(
    "Usage: npm run backfill -- path/to/archived/mTeam.json [...]",
  );
const schema = z.object({
  id: z.literal(leagueId),
  seasonId: z.literal(season),
  scoringPeriodId: z.number().int(),
  teams: z
    .array(
      z.object({
        id: z.number().int(),
        points: z.number().finite(),
        valuesByStat: z.record(z.string(), z.number()).optional(),
      }),
    )
    .min(1),
});
const observations = [];
for (const file of files) {
  const snapshot = schema.parse(JSON.parse(await readFile(file, "utf8")));
  if (
    new Set(snapshot.teams.map((team) => team.id)).size !==
    snapshot.teams.length
  )
    throw new Error("Archive contains duplicate team IDs.");
  // Only use original captures whose file modification time is still intact.
  const timestamp = (await stat(file)).mtime.toISOString();
  observations.push({
    timestamp,
    period: snapshot.scoringPeriodId,
    points: Object.fromEntries(
      snapshot.teams.map((team) => [team.id, team.points]),
    ),
    // ESPN stat 30: games played in active lineup slots.
    games: Object.fromEntries(
      snapshot.teams.flatMap((team) =>
        team.valuesByStat?.["30"] === undefined
          ? []
          : [[team.id, team.valuesByStat["30"]]],
      ),
    ),
  });
  console.log(`Archive ${file}: ${timestamp}, ${snapshot.teams.length} teams`);
}
const store = new Store(
  resolve(root, process.env.DATA_DIR ?? "data", `${leagueId}-${season}.sqlite`),
);
try {
  const { imported, gamesAdded } = store.backfill(observations);
  console.log(
    `Imported ${imported} historical captures; added games played to ${gamesAdded} existing captures.`,
  );
} finally {
  store.close();
}
