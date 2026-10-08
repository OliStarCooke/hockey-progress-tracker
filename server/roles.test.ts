import { test } from "node:test";
import assert from "node:assert/strict";
import type { RoleDay } from "./espn.ts";
import { reconcileRoles, roleSummary } from "./roles.ts";
const day = (period: number, slot: number, points: number, games: number) => ({
  period,
  teamId: 3,
  slot,
  points,
  games,
});
const espn: Record<number, RoleDay[]> = {
  1: [day(1, 3, 4.85, 2), day(1, 5, 1.2, 1), day(1, 7, 9, 2)],
  2: [day(2, 3, 2.6, 1), day(2, 5, 0, 0)],
  3: [day(3, 3, 8.15, 3), day(3, 5, -0.5, 1)],
};
function fetcher(source = espn) {
  const requested: number[] = [];
  return {
    requested,
    fetchDay: async (period: number) => {
      requested.push(period);
      return source[period] ?? [];
    },
  };
}
const totals = new Map([[3, { points: 16.3, games: 8 }]]);
test("only missing completed days are fetched when stored days reconcile", async () => {
  const { requested, fetchDay } = fetcher();
  const days = await reconcileRoles({
    stored: [...espn[1]!, ...espn[2]!],
    current: 4,
    totals,
    capped: [3, 5],
    fetchDay,
  });
  assert.deepEqual(requested, [3]);
  assert.deepEqual(days, espn[3]);
  const none = fetcher();
  assert.deepEqual(
    await reconcileRoles({
      stored: Object.values(espn).flat(),
      current: 4,
      totals,
      capped: [3, 5],
      fetchDay: none.fetchDay,
    }),
    [],
  );
  assert.deepEqual(none.requested, []);
});
test("a stat correction refetches stored days until totals reconcile", async () => {
  const { requested, fetchDay } = fetcher();
  const stale = [day(1, 3, 3.85, 2), ...espn[1]!.slice(1), ...espn[2]!];
  const days = await reconcileRoles({
    stored: stale,
    current: 4,
    totals,
    capped: [3, 5],
    fetchDay,
  });
  assert.deepEqual(requested, [3, 1, 2]);
  assert.equal(
    roleSummary(
      [
        ...stale.filter((row) => !days.some((d) => d.period === row.period)),
        ...days,
      ],
      [3, 5],
    ).teams[3]?.[3]?.points,
    15.6,
  );
});
test("unreconcilable data is rejected so the last good breakdown stays", async () => {
  await assert.rejects(
    reconcileRoles({
      stored: [],
      current: 4,
      totals: new Map([[3, { points: 16.3, games: 9 }]]),
      capped: [3, 5],
      fetchDay: fetcher().fetchDay,
    }),
    /does not match/,
  );
});
test("role summary totals slots, splits daily bench points, and measures spread", () => {
  const summary = roleSummary(Object.values(espn).flat(), [3, 5]);
  assert.equal(summary.through, 3);
  assert.deepEqual(summary.teams[3], {
    3: { points: 15.6, games: 6 },
    5: { points: 0.7, games: 2 },
    7: { points: 9, games: 2 },
  });
  assert.deepEqual(summary.days[0], {
    period: 1,
    points: { 3: 6.05 },
    games: { 3: 3 },
    bench: { 3: 9 },
  });
  // Forward days: 4.85/2, 2.6/1, 8.15/3 around the 2.6 league mean.
  const expected = Math.sqrt(
    ((4.85 - 5.2) ** 2 / 2 + 0 + (8.15 - 7.8) ** 2 / 3) / 3,
  );
  assert.ok(Math.abs((summary.sd[3] ?? 0) - expected) < 1e-9);
  assert.deepEqual(roleSummary([], [3]), {
    through: null,
    teams: {},
    sd: {},
    days: [],
  });
});
