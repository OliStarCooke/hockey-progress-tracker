import type { Store } from "./store.ts";
import type { RoleDay } from "./espn.ts";
import type { Observation } from "../src/lib/schema.ts";
/** Official totals exclude the current scoring day. Keep its provisional total separately. */
export async function collectLive(
  store: Store,
  data: {
    scoringPeriodId: number;
    slotCaps: Record<string, number>;
    teams: { id: number; points: number; games: number | null }[];
  },
  timestamp: string,
  fetchDay: (period: number, slots: number[]) => Promise<RoleDay[]>,
) {
  const slots = Object.keys(data.slotCaps).map(Number);
  if (!slots.length)
    throw new Error("ESPN did not report positional games caps.");
  const days = await fetchDay(data.scoringPeriodId, slots);
  if (
    days.length !== data.teams.length * slots.length ||
    data.teams.some((team) =>
      slots.some(
        (slot) =>
          days.filter(
            (day) =>
              day.period === data.scoringPeriodId &&
              day.teamId === team.id &&
              day.slot === slot,
          ).length !== 1,
      ),
    )
  )
    throw new Error(
      "ESPN returned an incomplete live lineup. Keeping the last live scores.",
    );
  const completed = store.roleDays();
  const observation: Observation = {
    timestamp,
    period: data.scoringPeriodId,
    points: {},
    games: {},
  };
  for (const team of data.teams) {
    let points = team.points;
    let games = team.games;
    for (const day of days.filter((day) => day.teamId === team.id)) {
      const played = completed
        .filter(
          (row) =>
            row.period < data.scoringPeriodId &&
            row.teamId === team.id &&
            row.slot === day.slot,
        )
        .reduce((sum, row) => sum + row.games, 0);
      // ESPN allows the full day's lineup when a role starts below its cap.
      if (played >= data.slotCaps[day.slot]!) continue;
      points += day.points;
      if (games !== null) games += day.games;
    }
    observation.points[team.id] = Math.round(points * 100) / 100;
    if (games !== null) observation.games[team.id] = games;
  }
  store.setMeta("liveObservation", JSON.stringify(observation));
}
