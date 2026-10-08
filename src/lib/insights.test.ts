import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayObservations,
  formAt,
  leagueRate,
  periodDate,
  rolePace,
  seasonFraction,
  simulateSeason,
} from "./insights.ts";
import { localDay } from "./metrics.ts";
import type { Dashboard } from "./schema.ts";
const roles: Dashboard["roles"] = {
  through: 3,
  caps: { "3": 100, "5": 10 },
  sd: { "3": 1.5, "5": 2 },
  teams: {
    "3": { "3": { points: 40, games: 20 }, "5": { points: 0, games: 0 } },
    "9": { "3": { points: 10, games: 10 }, "5": { points: 6, games: 2 } },
  },
  days: [
    {
      period: 1,
      points: { "3": 10, "9": 4 },
      games: { "3": 5, "9": 4 },
      bench: { "3": 2 },
    },
    {
      period: 2,
      points: { "3": 0, "9": 0 },
      games: { "3": 0, "9": 0 },
      bench: {},
    },
    {
      period: 3,
      points: { "3": 30, "9": 12 },
      games: { "3": 15, "9": 8 },
      bench: {},
    },
  ],
};
test("scoring days become exact cumulative daily observations on game dates", () => {
  assert.equal(periodDate("2026-09-29", 1), "2026-09-29");
  assert.equal(periodDate("2026-09-29", 194), "2027-04-10");
  const series = dayObservations(roles, "2026-12-30");
  assert.deepEqual(
    series.map((row) => localDay(row.timestamp)),
    ["2026-12-30", "2026-12-31", "2027-01-01"],
  );
  assert.deepEqual(series[2]?.points, { "3": 40, "9": 16 });
  assert.deepEqual(series[2]?.games, { "3": 20, "9": 12 });
});
test("form uses only the trailing window of scoring days", () => {
  const series = dayObservations(roles, "2026-09-29");
  assert.equal(formAt(series, 2, 3, 2), 2);
  assert.equal(formAt(series, 2, 9, 1), 1.5);
  assert.equal(formAt(series, 1, 3, 1), null);
  assert.equal(formAt(series, 2, 99), null);
});
test("cap pace follows the share of NHL games played", () => {
  const schedule = {
    start: "2026-09-29",
    finalPeriod: 4,
    nhlGames: { "1": 10, "2": 0, "3": 30, "4": 60 },
  };
  assert.equal(seasonFraction(schedule, 3), 0.4);
  assert.equal(seasonFraction(schedule, 4), 1);
});
test("role pace projects each role separately and falls back to the league rate", () => {
  assert.equal(leagueRate(roles, "5"), 3);
  // Forwards 2.00 × 100; goalies have no games, so 10 × league 3.00.
  assert.equal(rolePace(roles, 3), 230);
  assert.equal(rolePace(roles, 9), 10 + 90 * 1 + 6 + 8 * 3);
  assert.equal(
    rolePace({ ...roles, teams: { "3": roles.teams["3"]! } }, 3),
    null,
  );
});
test("season simulation is reproducible and favours the stronger team", () => {
  const outlook = simulateSeason(roles, [3, 9], { runs: 2000 });
  assert.ok(outlook);
  const astra = outlook.get(3)!;
  const other = outlook.get(9)!;
  assert.deepEqual(
    simulateSeason(roles, [3, 9], { runs: 2000 })?.get(3),
    astra,
  );
  // Shrunk forward rates: (40 + 25 × 5/3) / 45 and (10 + 25 × 5/3) / 35; goalies stay at 3.
  assert.ok(Math.abs(astra.median - (40 + 80 * (245 / 135) + 30)) < 5);
  assert.ok(Math.abs(other.median - (10 + 90 * (155 / 105) + 30)) < 5);
  assert.ok(astra.win > 0.8);
  assert.equal(astra.top3, 1);
  assert.ok(Math.abs(astra.win + other.win - 1) < 1e-9);
  assert.ok(astra.low < astra.median && astra.median < astra.high);
  assert.equal(simulateSeason({ ...roles, sd: { "3": 1.5 } }, [3, 9]), null);
});
