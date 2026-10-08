import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { fetchRoleDay } from "./espn.ts";
import { collectLive } from "./live.ts";
const data = {
  scoringPeriodId: 5,
  slotCaps: { "3": 10, "5": 2 },
  teams: [{ id: 3, name: "Astra", abbrev: "AST", points: 36.8, games: 4 }],
};
test("live player points update totals without accumulating captures, then finalize without double counting", async (context) => {
  const store = new Store(":memory:");
  store.save(data.teams, 5, "2026-10-04T01:00:00.000Z");
  store.saveRoleDays([
    { period: 4, teamId: 3, slot: 3, points: 30, games: 2 },
    { period: 4, teamId: 3, slot: 5, points: 6.8, games: 2 },
  ]);
  let points = 16.75;
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({
      seasonId: 2027,
      teams: [
        {
          id: 3,
          roster: {
            entries: [3, 5, 7].map((lineupSlotId) => ({
              lineupSlotId,
              playerPoolEntry: {
                player: {
                  stats: [
                    {
                      scoringPeriodId: 5,
                      statSourceId: 0,
                      statSplitTypeId: 5,
                      appliedTotal: lineupSlotId === 3 ? points : 100,
                      stats: { "30": 1 },
                    },
                  ],
                },
              },
            })),
          },
        },
      ],
    }),
  );
  const fetchDay = (period: number, slots: number[]) =>
    fetchRoleDay(1, 2027, "/tmp/no-tracker-cookies", period, slots);
  for (let i = 0; i < 100; i++) {
    points = 16.75 + i;
    await collectLive(
      store,
      data,
      `2026-10-04T02:${String(i % 60).padStart(2, "0")}:00.000Z`,
      fetchDay,
    );
    assert.equal(
      store.liveObservation()?.points[3],
      Math.round((36.8 + points) * 100) / 100,
    );
    assert.equal(store.liveObservation()?.games[3], 5);
    assert.equal(store.observations().length, 1);
  }
  // Missing teams must not replace the last successful live snapshot.
  await assert.rejects(
    collectLive(store, data, "2026-10-04T03:00:00.000Z", async () => []),
    /incomplete/,
  );
  assert.equal(store.liveObservation()?.points[3], 152.55);
  store.save(
    [{ ...data.teams[0]!, points: 152.55, games: 5 }],
    6,
    "2026-10-04T12:00:00.000Z",
  );
  assert.equal(store.liveObservation(), null);
  assert.equal(store.observations().at(-1)?.points[3], 152.55);
  store.close();
});
