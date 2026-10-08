import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  espnSecretsStatus,
  fetchEspn,
  fetchRoleDay,
  fetchSchedule,
} from "./espn.ts";
const valid = {
  seasonId: 2027,
  scoringPeriodId: 4,
  teams: [
    {
      id: 3,
      name: "Astra",
      abbrev: "AST",
      points: 27.15,
      valuesByStat: { "1": 4, "30": 15 },
    },
  ],
  settings: {
    rosterSettings: {
      lineupSlotStatLimits: {
        "3": { statId: 30, limitValue: 689 },
        "4": { statId: 30, limitValue: 383 },
        "5": { statId: 30, limitValue: 164 },
        "6": { statId: 30, limitValue: 77 },
      },
    },
  },
};
test("ESPN boundary reads games played and the season games cap when reported", async (context) => {
  const responses = [
    new Response(JSON.stringify(valid)),
    new Response(
      JSON.stringify({
        seasonId: 2027,
        scoringPeriodId: 4,
        teams: [{ id: 3, name: "Astra", abbrev: "AST", points: 27.15 }],
      }),
    ),
  ];
  context.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
  const reported = await fetchEspn(
    918256829,
    2027,
    "/tmp/tracker-nonexistent-cookies",
  );
  assert.equal(reported.teams[0]?.games, 15);
  assert.equal(reported.gamesCap, 1313);
  assert.deepEqual(reported.slotCaps, { 3: 689, 4: 383, 5: 164, 6: 77 });
  const missing = await fetchEspn(
    918256829,
    2027,
    "/tmp/tracker-nonexistent-cookies",
  );
  assert.equal(missing.teams[0]?.games, null);
  assert.equal(missing.gamesCap, null);
});
test("ESPN boundary accepts valid totals and rejects incomplete, duplicate, wrong-season and unauthorized responses", async (context) => {
  const responses = [
    new Response(JSON.stringify(valid)),
    new Response(
      JSON.stringify({
        ...valid,
        teams: [{ id: 3, name: "Astra", abbrev: "AST", valuesByStat: {} }],
      }),
    ),
    new Response(
      JSON.stringify({ ...valid, teams: [...valid.teams, ...valid.teams] }),
    ),
    new Response(JSON.stringify({ ...valid, seasonId: 2026 })),
    new Response("Unauthorized", { status: 401 }),
    new Response("<html>Login page</html>"),
  ];
  context.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
  assert.equal(
    (await fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"))
      .teams[0]?.points,
    27.15,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"),
    /missing valid team totals/,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"),
    /duplicate team IDs/,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"),
    /different season/,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"),
    /HTTP 401/,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, "/tmp/tracker-nonexistent-cookies"),
    /invalid response/,
  );
});
test("HTTP 401 distinguishes missing cookies from rejected cookies", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-espn-"));
  const withCookies = join(dir, "with.env");
  writeFileSync(withCookies, 'espn_s2=dummy\nSWID="{dummy}"\n');
  const responses = [
    new Response("Unauthorized", { status: 401 }),
    new Response("Unauthorized", { status: 401 }),
  ];
  context.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
  await assert.rejects(
    fetchEspn(918256829, 2027, join(dir, "absent.env")),
    /HTTP 401 with no cookies sent/,
  );
  await assert.rejects(
    fetchEspn(918256829, 2027, withCookies),
    /HTTP 401. Check the server-side ESPN cookies if access has expired/,
  );
});
test("the secrets status reports key names without values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-espn-status-"));
  const missing = join(dir, "absent.env");
  const empty = join(dir, "empty.env");
  const partial = join(dir, "partial.env");
  const full = join(dir, "full.env");
  writeFileSync(empty, "# only a comment\nespn_s2=\n");
  writeFileSync(partial, "espn_s2=dummy\n");
  writeFileSync(full, 'espn_s2="dummy"\nSWID={dummy}\n');
  assert.match(await espnSecretsStatus(missing), /^missing \(/);
  assert.match(await espnSecretsStatus(empty), /^empty \(/);
  assert.match(await espnSecretsStatus(partial), /^partial \(missing swid\) \(/);
  assert.match(await espnSecretsStatus(full), /^found espn_s2 \+ SWID \(/);
  assert.doesNotMatch(
    await espnSecretsStatus(full),
    /dummy/,
    "status must never leak cookie values",
  );
});
test("a scoring day sums actual stats by capped lineup slot and ignores the bench", async (context) => {
  const player = (slot: number, period: number, points: number, games = 1) => ({
    lineupSlotId: slot,
    playerPoolEntry: {
      player: {
        stats: [
          {
            scoringPeriodId: 0,
            statSourceId: 0,
            statSplitTypeId: 0,
            appliedTotal: 99,
          },
          {
            scoringPeriodId: period,
            statSourceId: 1,
            statSplitTypeId: 5,
            appliedTotal: 7,
          },
          {
            scoringPeriodId: period,
            statSourceId: 0,
            statSplitTypeId: 5,
            appliedTotal: points,
            stats: { "30": games },
          },
        ],
      },
    },
  });
  const roster = {
    seasonId: 2027,
    teams: [
      {
        id: 3,
        roster: {
          entries: [
            player(3, 2, 1.1),
            player(3, 2, 2.2),
            player(5, 2, -0.3),
            player(7, 2, 5),
            player(3, 1, 4),
          ],
        },
      },
    ],
  };
  const responses = [
    new Response(JSON.stringify(roster)),
    new Response(JSON.stringify({ ...roster, seasonId: 2026 })),
  ];
  context.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  });
  assert.deepEqual(
    await fetchRoleDay(
      918256829,
      2027,
      "/tmp/tracker-nonexistent-cookies",
      2,
      [3, 4, 5],
    ),
    [
      { period: 2, teamId: 3, slot: 3, points: 3.3, games: 2 },
      { period: 2, teamId: 3, slot: 4, points: 0, games: 0 },
      { period: 2, teamId: 3, slot: 5, points: -0.3, games: 1 },
    ],
  );
  await assert.rejects(
    fetchRoleDay(918256829, 2027, "/tmp/tracker-nonexistent-cookies", 2, [3]),
    /invalid lineup/,
  );
});
test("the NHL schedule dates scoring days and counts games despite late starts", async (context) => {
  const game = (iso: string, scoringPeriodId: number) => ({
    date: Date.parse(iso),
    scoringPeriodId,
  });
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({
      settings: {
        proTeams: [
          {
            proGamesByScoringPeriod: {
              "1": [game("2026-09-29T23:00:00Z", 1)],
              "3": [game("2026-10-01T23:00:00Z", 3)],
            },
          },
          {
            proGamesByScoringPeriod: {
              // 10:30 p.m. Pacific is after midnight in Montreal.
              "3": [game("2026-10-02T05:30:00Z", 3)],
              "194": [game("2027-04-10T23:00:00Z", 194)],
            },
          },
          {},
        ],
      },
    }),
  );
  assert.deepEqual(
    await fetchSchedule(2027, "/tmp/tracker-nonexistent-cookies"),
    {
      start: "2026-09-29",
      finalPeriod: 194,
      nhlGames: { 1: 1, 3: 2, 194: 1 },
    },
  );
});
