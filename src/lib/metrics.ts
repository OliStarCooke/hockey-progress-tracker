import { formAt } from "./insights.ts";
import type { Observation, Team } from "./schema.ts";
export type Metric = "total" | "rate" | "form" | "change" | "gap" | "rank";
export function localDay(timestamp: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montreal",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
export function dailyObservations(observations: Observation[]) {
  const days = new Map<string, Observation>();
  for (const observation of observations)
    days.set(localDay(observation.timestamp), observation);
  return [...days.values()];
}
export function rankAt(observation: Observation, teamId: number) {
  const points = observation.points[teamId];
  return points === undefined
    ? null
    : 1 +
        Object.values(observation.points).filter((value) => value > points)
          .length;
}
/** Points per game played; unavailable until a team has played a game. */
export function pointsPerGame(observation: Observation, teamId: number) {
  const points = observation.points[teamId];
  const games = observation.games[teamId];
  return points === undefined || !games ? null : points / games;
}
/** League rank by points per game among teams with a known rate; ties share a rank. */
export function rateRankAt(observation: Observation, teamId: number) {
  const rate = pointsPerGame(observation, teamId);
  if (rate === null) return null;
  return (
    1 +
    Object.keys(observation.points).filter(
      (id) => (pointsPerGame(observation, Number(id)) ?? -Infinity) > rate,
    ).length
  );
}
export function metricValue(
  metric: Exclude<Metric, "form">,
  observation: Observation,
  previous: Observation | undefined,
  team: Team,
  baseline: number,
) {
  const points = observation.points[team.id];
  if (points === undefined) return null;
  switch (metric) {
    case "total":
      return points;
    case "rate":
      return pointsPerGame(observation, team.id);
    case "change": {
      const before = previous?.points[team.id];
      return before === undefined
        ? null
        : Math.round((points - before) * 100) / 100;
    }
    case "gap": {
      const reference = observation.points[baseline];
      return reference === undefined
        ? null
        : Math.round((points - reference) * 100) / 100;
    }
    case "rank":
      return rankAt(observation, team.id);
    default: {
      const exhaustive: never = metric;
      return exhaustive;
    }
  }
}
/** A metric's value at one point of a series; form needs one observation per scoring day. */
export function seriesValue(
  metric: Metric,
  series: Observation[],
  index: number,
  team: Team,
  baseline: number,
) {
  const observation = series[index];
  if (!observation) return null;
  return metric === "form"
    ? formAt(series, index, team.id)
    : metricValue(metric, observation, series[index - 1], team, baseline);
}
export function teamColor(id: number) {
  return `var(--team-${((id - 1) % 14) + 1})`;
}
