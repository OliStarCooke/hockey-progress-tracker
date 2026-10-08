import type { Dashboard, Observation } from "./schema.ts";
type Roles = Dashboard["roles"];
type Schedule = NonNullable<Dashboard["schedule"]>;
const round = (value: number) => Math.round(value * 100) / 100;
/** Calendar date (YYYY-MM-DD) of a scoring day; ESPN scoring days are consecutive. */
export function periodDate(start: string, period: number) {
  const [year, month, day] = start.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + period - 1))
    .toISOString()
    .slice(0, 10);
}
/**
 * Exact cumulative totals after each completed scoring day, one observation per
 * day, timestamped at midday in Montreal so date bucketing keeps the game date.
 */
export function dayObservations(roles: Roles, start: string): Observation[] {
  const points: Record<string, number> = {};
  const games: Record<string, number> = {};
  return roles.days.map((day) => {
    for (const [id, value] of Object.entries(day.points))
      points[id] = round((points[id] ?? 0) + value);
    for (const [id, value] of Object.entries(day.games))
      games[id] = (games[id] ?? 0) + value;
    return {
      timestamp: `${periodDate(start, day.period)}T16:00:00.000Z`,
      period: day.period,
      points: { ...points },
      games: { ...games },
    };
  });
}
/** Points per game over the last `window` scoring days of a one-per-day series. */
export function formAt(
  series: Observation[],
  index: number,
  teamId: number,
  window = 7,
) {
  const end = series[index];
  const points = end?.points[teamId];
  const games = end?.games[teamId];
  if (points === undefined || games === undefined) return null;
  const before = series[index - window];
  const played = games - (before?.games[teamId] ?? 0);
  return played > 0 ? (points - (before?.points[teamId] ?? 0)) / played : null;
}
/** Share of the NHL season's team-games completed through a scoring day. */
export function seasonFraction(schedule: Schedule, through: number) {
  let done = 0;
  let total = 0;
  for (const [period, games] of Object.entries(schedule.nhlGames)) {
    total += games;
    if (Number(period) <= through) done += games;
  }
  return total ? done / total : 0;
}
/** League-wide points per game in a slot, or null before anyone has played there. */
export function leagueRate(roles: Roles, slot: string) {
  let points = 0;
  let games = 0;
  for (const team of Object.values(roles.teams)) {
    points += team[slot]?.points ?? 0;
    games += team[slot]?.games ?? 0;
  }
  return games ? points / games : null;
}
/**
 * Projected season total if each role keeps its current points per game through
 * its remaining capped games. Roles without games use the league rate.
 */
export function rolePace(roles: Roles, teamId: number) {
  let total = 0;
  for (const [slot, cap] of Object.entries(roles.caps)) {
    const { points = 0, games = 0 } = roles.teams[teamId]?.[slot] ?? {};
    const rate = games ? points / games : leagueRate(roles, slot);
    if (rate === null) return null;
    total += points + Math.max(0, cap - games) * rate;
  }
  return total;
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export type Outlook = {
  median: number;
  low: number;
  high: number;
  win: number;
  top3: number;
};
/**
 * Simulates final standings, assuming every team fills its remaining capped games.
 * Each role's true rate blends the team's games with `priorGames` games at the
 * league rate, and is itself uncertain; game-to-game noise uses the slot's
 * observed spread. Returns null until every role has a rate and a spread.
 */
export function simulateSeason(
  roles: Roles,
  teamIds: number[],
  { runs = 4000, seed = 7, priorGames = 25 } = {},
): Map<number, Outlook> | null {
  const slots = Object.entries(roles.caps).map(([slot, cap]) => ({
    slot,
    cap,
    mean: leagueRate(roles, slot),
    sd: roles.sd[slot],
  }));
  if (
    !teamIds.length ||
    slots.some(({ mean, sd }) => mean === null || sd === undefined)
  )
    return null;
  const next = random(seed);
  const normal = () =>
    Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const finals = teamIds.map(() => new Float64Array(runs));
  const wins = teamIds.map(() => 0);
  const podiums = teamIds.map(() => 0);
  const totals = new Float64Array(teamIds.length);
  for (let run = 0; run < runs; run++) {
    teamIds.forEach((teamId, index) => {
      let total = 0;
      for (const { slot, cap, mean, sd } of slots) {
        const { points = 0, games = 0 } = roles.teams[teamId]?.[slot] ?? {};
        const remaining = Math.max(0, cap - games);
        const weight = games + priorGames;
        const rate =
          (points + priorGames * mean!) / weight +
          (sd! / Math.sqrt(weight)) * normal();
        total +=
          points + remaining * rate + sd! * Math.sqrt(remaining) * normal();
      }
      totals[index] = total;
      finals[index]![run] = total;
    });
    totals.forEach((total, index) => {
      const place = 1 + totals.filter((other) => other > total).length;
      if (place === 1) wins[index]!++;
      if (place <= 3) podiums[index]!++;
    });
  }
  return new Map(
    teamIds.map((teamId, index) => {
      const sorted = finals[index]!.sort();
      const at = (share: number) =>
        sorted[Math.min(runs - 1, Math.floor(share * runs))]!;
      return [
        teamId,
        {
          median: at(0.5),
          low: at(0.1),
          high: at(0.9),
          win: wins[index]! / runs,
          top3: podiums[index]! / runs,
        },
      ];
    }),
  );
}
