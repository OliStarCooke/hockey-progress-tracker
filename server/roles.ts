import type { RoleDay } from "./espn.ts";
type Totals = Map<number, { points: number; games: number | null }>;
function reconciles(days: RoleDay[], totals: Totals, capped: Set<number>) {
  for (const [teamId, total] of totals) {
    const team = days.filter(
      (day) => day.teamId === teamId && capped.has(day.slot),
    );
    const points = team.reduce((sum, day) => sum + day.points, 0);
    const games = team.reduce((sum, day) => sum + day.games, 0);
    if (Math.abs(points - total.points) > 0.005) return false;
    if (total.games !== null && games !== total.games) return false;
  }
  return true;
}
/**
 * Returns the scoring days to save so stored capped-slot breakdowns add up to
 * ESPN's official team totals. ESPN totals cover completed days only, so the
 * current day is never fetched. Missing days are fetched first; if totals still
 * differ (a stat correction), recent and then all completed days are fetched again.
 */
export async function reconcileRoles({
  stored,
  current,
  totals,
  capped,
  fetchDay,
}: {
  stored: RoleDay[];
  current: number;
  totals: Totals;
  capped: number[];
  fetchDay: (period: number) => Promise<RoleDay[]>;
}) {
  const completed = Array.from(
    { length: current - 1 },
    (_, index) => index + 1,
  );
  const fetched = new Map<number, RoleDay[]>();
  const storedPeriods = new Set(stored.map((day) => day.period));
  for (const refresh of [
    completed.filter((period) => !storedPeriods.has(period)),
    completed.slice(-7),
    completed,
  ]) {
    for (const period of refresh)
      if (!fetched.has(period)) fetched.set(period, await fetchDay(period));
    const merged = [
      ...stored.filter(
        (day) => day.period < current && !fetched.has(day.period),
      ),
      ...[...fetched.values()].flat(),
    ];
    if (reconciles(merged, totals, new Set(capped)))
      return [...fetched.values()].flat();
  }
  throw new Error(
    "Role breakdown does not match ESPN team totals. Showing the last breakdown that did.",
  );
}
const round = (value: number) => Math.round(value * 100) / 100;
/**
 * Season-to-date totals per team and slot, daily team totals for capped slots,
 * bench points per day, and each capped slot's per-game standard deviation.
 */
export function roleSummary(days: RoleDay[], capped: number[]) {
  const cappedSlots = new Set(capped);
  const teams: Record<
    string,
    Record<string, { points: number; games: number }>
  > = {};
  const byPeriod = new Map<
    number,
    {
      period: number;
      points: Record<string, number>;
      games: Record<string, number>;
      bench: Record<string, number>;
    }
  >();
  for (const day of days) {
    const slots = (teams[day.teamId] ??= {});
    const total = (slots[day.slot] ??= { points: 0, games: 0 });
    total.points = round(total.points + day.points);
    total.games += day.games;
    let period = byPeriod.get(day.period);
    if (!period) {
      period = { period: day.period, points: {}, games: {}, bench: {} };
      byPeriod.set(day.period, period);
    }
    if (cappedSlots.has(day.slot)) {
      period.points[day.teamId] = round(
        (period.points[day.teamId] ?? 0) + day.points,
      );
      period.games[day.teamId] = (period.games[day.teamId] ?? 0) + day.games;
    } else
      period.bench[day.teamId] = round(
        (period.bench[day.teamId] ?? 0) + day.points,
      );
  }
  // A day's slot average over g games has variance sd²/g around the league mean.
  const sd: Record<string, number> = {};
  for (const slot of capped) {
    const samples = days.filter((day) => day.slot === slot && day.games > 0);
    const games = samples.reduce((sum, day) => sum + day.games, 0);
    if (samples.length < 2 || !games) continue;
    const mean = samples.reduce((sum, day) => sum + day.points, 0) / games;
    sd[slot] = Math.sqrt(
      samples.reduce(
        (sum, day) => sum + (day.points - day.games * mean) ** 2 / day.games,
        0,
      ) / samples.length,
    );
  }
  return {
    through: days.length ? Math.max(...days.map((day) => day.period)) : null,
    teams,
    sd,
    days: [...byPeriod.values()].sort((a, b) => a.period - b.period),
  };
}
