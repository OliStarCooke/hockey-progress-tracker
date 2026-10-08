import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyObservations,
  metricValue,
  pointsPerGame,
  rankAt,
  rateRankAt,
} from "./metrics.ts";
import type { Observation } from "./schema.ts";
const astra = { id: 3, name: "Astra", abbrev: "AST" };
const observations: Observation[] = [
  {
    timestamp: "2026-10-02T02:00:00Z",
    period: 1,
    points: { 3: 10, 10: 10, 14: 12 },
    games: {},
  },
  {
    timestamp: "2026-10-02T03:00:00Z",
    period: 1,
    points: { 3: 11, 10: 11, 14: 12 },
    games: { 3: 0, 10: 5, 14: 6 },
  },
  {
    timestamp: "2026-10-02T05:00:00Z",
    period: 2,
    points: { 3: 9, 10: 15, 14: 15 },
    games: { 3: 6, 10: 10, 14: 10 },
  },
];
test("daily buckets use Montreal day boundaries and retain the last capture", () => {
  assert.deepEqual(dailyObservations(observations), [
    observations[1],
    observations[2],
  ]);
});
test("gaps, corrections, first changes, and tied ranks use full league totals", () => {
  const first = observations[0]!;
  const current = observations[2]!;
  assert.equal(rankAt(first, 3), 2);
  assert.equal(rankAt(current, 10), 1);
  assert.equal(rankAt(current, 3), 3);
  assert.equal(metricValue("gap", current, first, astra, 14), -6);
  assert.equal(metricValue("change", current, first, astra, 14), -1);
  assert.equal(metricValue("change", first, undefined, astra, 14), null);
  assert.equal(metricValue("gap", current, first, astra, 99), null);
});
test("points per game needs played games and ranks ties together", () => {
  const [unknown, early, current] = observations as [
    Observation,
    Observation,
    Observation,
  ];
  assert.equal(pointsPerGame(unknown, 3), null);
  assert.equal(pointsPerGame(early, 3), null);
  assert.equal(pointsPerGame(early, 14), 2);
  assert.equal(rateRankAt(early, 10), 1);
  assert.equal(rateRankAt(early, 14), 2);
  assert.equal(rateRankAt(early, 3), null);
  assert.equal(metricValue("rate", current, early, astra, 14), 1.5);
  assert.equal(rateRankAt(current, 10), 1);
  assert.equal(rateRankAt(current, 14), 1);
  assert.equal(rateRankAt(current, 3), 1);
  assert.equal(
    rateRankAt({ ...current, games: { ...current.games, 3: 9 } }, 3),
    3,
  );
});
