import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { RoleDay } from "./espn.ts";
import {
  teamSchema,
  observationSchema,
  type Observation,
} from "../src/lib/schema.ts";
const pointRow = z.object({
  timestamp: z.string(),
  period: z.number(),
  team_id: z.number(),
  points: z.number(),
  games: z.number().nullable(),
});
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, abbrev TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS points (timestamp TEXT NOT NULL, period INTEGER NOT NULL, team_id INTEGER NOT NULL, points REAL NOT NULL, games INTEGER, PRIMARY KEY(timestamp,team_id));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS role_days (period INTEGER NOT NULL, team_id INTEGER NOT NULL, slot INTEGER NOT NULL, points REAL NOT NULL, games INTEGER NOT NULL, PRIMARY KEY(period,team_id,slot));`);
    // Databases created before games tracking keep their history; old rows have no games.
    const columns = z
      .array(z.object({ name: z.string() }))
      .parse(this.db.prepare("PRAGMA table_info(points)").all());
    if (!columns.some((column) => column.name === "games"))
      this.db.exec("ALTER TABLE points ADD COLUMN games INTEGER");
    // Version 2 adds bench rows; older scoring days are refetched on the next sync.
    if (this.meta("roleDaysVersion") !== "2") {
      this.db.exec("DELETE FROM role_days");
      this.setMeta("roleDaysVersion", "2");
    }
  }
  save(
    teams: (z.infer<typeof teamSchema> & {
      points: number;
      games: number | null;
    })[],
    period: number,
    timestamp: string,
    gamesCap: number | null = null,
  ) {
    const changed = this.differsFromLatest(teams, period);
    this.db.exec("BEGIN");
    try {
      const teamStatement = this.db.prepare(
        "INSERT INTO teams VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, abbrev=excluded.abbrev",
      );
      const pointStatement = this.db.prepare(
        "INSERT INTO points (timestamp,period,team_id,points,games) VALUES (?,?,?,?,?) ON CONFLICT(timestamp,team_id) DO UPDATE SET points=excluded.points, period=excluded.period, games=excluded.games",
      );
      for (const team of teams) {
        teamStatement.run(team.id, team.name, team.abbrev);
        if (changed)
          pointStatement.run(
            timestamp,
            period,
            team.id,
            team.points,
            team.games,
          );
      }
      if (gamesCap !== null) this.setMeta("gamesCap", String(gamesCap));
      const live = this.liveObservation();
      if (live && live.period !== period) this.setMeta("liveObservation", "");
      this.setMeta("lastSuccess", timestamp);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return changed;
  }
  /** Frequent syncs mostly see unchanged totals; only changes become new captures. */
  private differsFromLatest(
    teams: { id: number; points: number; games: number | null }[],
    period: number,
  ) {
    const latest = z
      .array(pointRow)
      .parse(
        this.db
          .prepare(
            "SELECT * FROM points WHERE timestamp=(SELECT MAX(timestamp) FROM points)",
          )
          .all(),
      );
    return (
      latest.length !== teams.length ||
      teams.some((team) => {
        const row = latest.find((item) => item.team_id === team.id);
        return (
          !row ||
          row.period !== period ||
          row.points !== team.points ||
          row.games !== team.games
        );
      })
    );
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  backfill(observations: Observation[]) {
    const existing = this.observations();
    const earliest = existing[0]?.timestamp;
    const ids = this.teams().map((team) => String(team.id));
    if (!earliest || ids.length === 0)
      throw new Error("Capture live league data before importing history.");
    const known = new Set(existing.map((row) => row.timestamp));
    const rows = observations.map((row) => observationSchema.parse(row));
    for (const row of rows) {
      const timestamp = Date.parse(row.timestamp);
      if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString() !== row.timestamp
      )
        throw new Error("History timestamps must be canonical UTC timestamps.");
      if (timestamp >= Date.parse(earliest) && !known.has(row.timestamp))
        throw new Error("Backfill must precede existing history.");
      if (
        Object.keys(row.points).length !== ids.length ||
        ids.some((id) => row.points[id] === undefined)
      )
        throw new Error(
          "Backfill must contain exactly the current league's teams.",
        );
      const games = Object.keys(row.games);
      if (
        games.length &&
        (games.length !== ids.length ||
          ids.some((id) => row.games[id] === undefined))
      )
        throw new Error(
          "Backfill games must cover exactly the current league's teams.",
        );
    }
    let imported = 0;
    let gamesAdded = 0;
    this.db.exec("BEGIN");
    try {
      const insert = this.db.prepare(
        "INSERT INTO points (timestamp,period,team_id,points,games) VALUES (?,?,?,?,?)",
      );
      // Existing captures only gain missing games; their recorded totals stay intact.
      const addGames = this.db.prepare(
        "UPDATE points SET games=? WHERE timestamp=? AND team_id=? AND games IS NULL",
      );
      for (const row of rows) {
        if (known.has(row.timestamp)) {
          let changed = 0;
          for (const id of ids)
            if (row.games[id] !== undefined)
              changed += Number(
                addGames.run(row.games[id], row.timestamp, Number(id)).changes,
              );
          if (changed) gamesAdded++;
          continue;
        }
        for (const id of ids)
          insert.run(
            row.timestamp,
            row.period,
            Number(id),
            row.points[id]!,
            row.games[id] ?? null,
          );
        known.add(row.timestamp);
        imported++;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { imported, gamesAdded };
  }
  /** Replaces whole scoring days so a corrected day never mixes old and new rows. */
  saveRoleDays(days: RoleDay[]) {
    this.db.exec("BEGIN");
    try {
      const clear = this.db.prepare("DELETE FROM role_days WHERE period=?");
      const insert = this.db.prepare(
        "INSERT INTO role_days (period,team_id,slot,points,games) VALUES (?,?,?,?,?)",
      );
      for (const period of new Set(days.map((day) => day.period)))
        clear.run(period);
      for (const day of days)
        insert.run(day.period, day.teamId, day.slot, day.points, day.games);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  roleDays(): RoleDay[] {
    return z
      .array(
        z
          .object({
            period: z.number(),
            team_id: z.number(),
            slot: z.number(),
            points: z.number(),
            games: z.number(),
          })
          .transform(({ team_id, ...day }) => ({ ...day, teamId: team_id })),
      )
      .parse(
        this.db
          .prepare("SELECT * FROM role_days ORDER BY period,team_id,slot")
          .all(),
      );
  }
  meta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(key);
    return row ? z.object({ value: z.string() }).parse(row).value : null;
  }
  teams() {
    return z
      .array(teamSchema)
      .parse(this.db.prepare("SELECT * FROM teams ORDER BY id").all());
  }
  observations(): Observation[] {
    const rows = z
      .array(pointRow)
      .parse(
        this.db
          .prepare("SELECT * FROM points ORDER BY timestamp,team_id")
          .all(),
      );
    const observations = new Map<string, Observation>();
    for (const row of rows) {
      let observation = observations.get(row.timestamp);
      if (!observation) {
        observation = {
          timestamp: row.timestamp,
          period: row.period,
          points: {},
          games: {},
        };
        observations.set(row.timestamp, observation);
      }
      observation.points[row.team_id] = row.points;
      if (row.games !== null) observation.games[row.team_id] = row.games;
    }
    return [...observations.values()];
  }
  liveObservation(): Observation | null {
    const value = this.meta("liveObservation");
    return value ? observationSchema.parse(JSON.parse(value)) : null;
  }
  close() {
    this.db.close();
  }
}
