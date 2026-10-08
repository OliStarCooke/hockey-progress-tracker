import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "./store.ts";
test("backfill is atomic, repeatable and preserves live totals, names and sync metadata", () => {
  const store = new Store(":memory:");
  store.save(
    [{ id: 3, name: "Astra", abbrev: "AST", points: 27.15, games: null }],
    4,
    "2026-10-02T13:00:00.000Z",
  );
  store.setMeta("lastAttempt", "2026-10-02T13:00:00.000Z");
  const archive = {
    timestamp: "2026-10-01T13:00:00.000Z",
    period: 3,
    points: { "3": 9.85 },
    games: { "3": 8 },
  };
  assert.throws(
    () => store.backfill([archive, { ...archive, points: { "4": 1 } }]),
    /exactly/,
  );
  assert.equal(store.observations().length, 1);
  assert.throws(
    () =>
      store.backfill([{ ...archive, timestamp: "2026-10-03T13:00:00.000Z" }]),
    /precede/,
  );
  assert.throws(() => store.backfill([{ ...archive, points: { "3": NaN } }]));
  assert.throws(
    () => store.backfill([{ ...archive, games: { "4": 8 } }]),
    /games must cover/,
  );
  assert.deepEqual(store.backfill([archive]), { imported: 1, gamesAdded: 0 });
  assert.deepEqual(store.backfill([archive]), { imported: 0, gamesAdded: 0 });
  assert.equal(store.observations()[0]?.points[3], 9.85);
  assert.equal(store.observations()[0]?.games[3], 8);
  const live = {
    ...archive,
    timestamp: "2026-10-02T13:00:00.000Z",
    points: { "3": 1 },
    games: { "3": 15 },
  };
  assert.deepEqual(store.backfill([live]), { imported: 0, gamesAdded: 1 });
  assert.deepEqual(store.backfill([live]), { imported: 0, gamesAdded: 0 });
  assert.equal(store.observations()[1]?.games[3], 15);
  assert.equal(store.observations()[1]?.points[3], 27.15);
  assert.equal(store.teams()[0]?.name, "Astra");
  assert.equal(store.meta("lastSuccess"), "2026-10-02T13:00:00.000Z");
  assert.equal(store.meta("lastAttempt"), "2026-10-02T13:00:00.000Z");
  store.close();
});
test("snapshots survive reopening and duplicate abbreviations retain separate identities", () => {
  const directory = mkdtempSync(join(tmpdir(), "tracker-test-"));
  const path = join(directory, "history.sqlite");
  const teams = [
    { id: 10, name: "Félix", abbrev: "FFT", points: 12.4, games: 9 },
    { id: 14, name: "Frank", abbrev: "FFT", points: 20, games: null },
  ];
  const store = new Store(path);
  store.save(teams, 1, "2026-10-02T16:00:00.000Z", 1313);
  store.save(
    teams.map((team) => ({ ...team, points: team.points - 2 })),
    2,
    "2026-10-03T16:00:00.000Z",
  );
  store.close();
  const reopened = new Store(path);
  assert.equal(reopened.teams().length, 2);
  assert.equal(reopened.observations().length, 2);
  assert.equal(reopened.observations()[1]?.points[14], 18);
  assert.deepEqual(reopened.observations()[1]?.games, { "10": 9 });
  assert.equal(reopened.meta("gamesCap"), "1313");
  assert.equal(reopened.meta("lastSuccess"), "2026-10-03T16:00:00.000Z");
  reopened.close();
  rmSync(directory, { recursive: true });
});
test("failed snapshot transaction preserves old totals and metadata", () => {
  const store = new Store(":memory:");
  store.save(
    [{ id: 3, name: "Astra", abbrev: "AST", points: 20, games: 5 }],
    1,
    "2026-10-02T16:00:00.000Z",
  );
  assert.throws(() =>
    store.save(
      [{ id: 3, name: "Astra", abbrev: "AST", points: NaN, games: 6 }],
      2,
      "2026-10-03T16:00:00.000Z",
    ),
  );
  assert.equal(store.observations().length, 1);
  assert.equal(store.meta("lastSuccess"), "2026-10-02T16:00:00.000Z");
  store.close();
});
test("databases created before games tracking keep their history", () => {
  const directory = mkdtempSync(join(tmpdir(), "tracker-test-"));
  const path = join(directory, "history.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, abbrev TEXT NOT NULL);
    CREATE TABLE points (timestamp TEXT NOT NULL, period INTEGER NOT NULL, team_id INTEGER NOT NULL, points REAL NOT NULL, PRIMARY KEY(timestamp,team_id));
    INSERT INTO teams VALUES (3,'Astra','AST');
    INSERT INTO points VALUES ('2026-10-01T13:00:00.000Z',3,3,9.85);`);
  legacy.close();
  const store = new Store(path);
  store.save(
    [{ id: 3, name: "Astra", abbrev: "AST", points: 27.15, games: 15 }],
    4,
    "2026-10-02T13:00:00.000Z",
  );
  assert.deepEqual(
    store.observations().map((row) => [row.points[3], row.games[3]]),
    [
      [9.85, undefined],
      [27.15, 15],
    ],
  );
  store.close();
  rmSync(directory, { recursive: true });
});
test("saving a scoring day replaces it entirely", () => {
  const store = new Store(":memory:");
  const row = { period: 1, teamId: 3, slot: 3, points: 4, games: 2 };
  store.saveRoleDays([row, { ...row, slot: 4 }, { ...row, period: 2 }]);
  store.saveRoleDays([{ ...row, points: 5 }]);
  assert.deepEqual(store.roleDays(), [
    { ...row, points: 5 },
    { ...row, period: 2 },
  ]);
  store.close();
});
test("scoring days saved before bench tracking are cleared for refetching", () => {
  const directory = mkdtempSync(join(tmpdir(), "tracker-test-"));
  const path = join(directory, "history.sqlite");
  const first = new Store(path);
  first.saveRoleDays([{ period: 1, teamId: 3, slot: 3, points: 4, games: 2 }]);
  first.setMeta("roleDaysVersion", "1");
  first.close();
  const reopened = new Store(path);
  assert.deepEqual(reopened.roleDays(), []);
  assert.equal(reopened.meta("roleDaysVersion"), "2");
  reopened.saveRoleDays([
    { period: 1, teamId: 3, slot: 3, points: 4, games: 2 },
  ]);
  reopened.close();
  const kept = new Store(path);
  assert.equal(kept.roleDays().length, 1);
  kept.close();
  rmSync(directory, { recursive: true });
});
test("unchanged totals refresh sync metadata without adding a capture", () => {
  const store = new Store(":memory:");
  const astra = {
    id: 3,
    name: "Astra",
    abbrev: "AST",
    points: 27.15,
    games: 15,
  };
  assert.equal(store.save([astra], 4, "2026-10-02T13:00:00.000Z"), true);
  assert.equal(
    store.save([{ ...astra, name: "Astra!" }], 4, "2026-10-02T13:15:00.000Z"),
    false,
  );
  assert.equal(store.observations().length, 1);
  assert.equal(store.teams()[0]?.name, "Astra!");
  assert.equal(store.meta("lastSuccess"), "2026-10-02T13:15:00.000Z");
  assert.equal(store.save([astra], 5, "2026-10-02T13:30:00.000Z"), true);
  assert.equal(
    store.save([{ ...astra, games: 16 }], 5, "2026-10-02T13:45:00.000Z"),
    true,
  );
  assert.equal(
    store.save(
      [{ ...astra, points: 30, games: 16 }],
      5,
      "2026-10-02T14:00:00.000Z",
    ),
    true,
  );
  assert.equal(store.observations().length, 4);
  store.close();
});

test("a replaceable live snapshot survives restart without becoming capture history", () => {
  const directory = mkdtempSync(join(tmpdir(), "tracker-live-test-"));
  const path = join(directory, "history.sqlite");
  const store = new Store(path);
  store.save(
    [{ id: 3, name: "Astra", abbrev: "AST", points: 36.8, games: 22 }],
    5,
    "2026-10-04T01:00:00.000Z",
  );
  for (let i = 0; i < 1000; i++)
    store.setMeta(
      "liveObservation",
      JSON.stringify({
        timestamp: "2026-10-04T02:00:00.000Z",
        period: 5,
        points: { "3": 53.55 + i },
        games: { "3": 30 },
      }),
    );
  store.close();
  const reopened = new Store(path);
  assert.equal(reopened.liveObservation()?.points[3], 1052.55);
  assert.equal(reopened.observations().length, 1);
  reopened.close();
  const db = new DatabaseSync(path);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM metadata WHERE key='liveObservation'",
      )
      .get()?.count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM points").get()?.count,
    1,
  );
  assert.ok(Number(db.prepare("PRAGMA page_count").get()?.page_count) < 20);
  db.close();
  rmSync(directory, { recursive: true });
});
