import { readFile } from "node:fs/promises";
import { z } from "zod";
// ESPN stat 30 counts games played in active lineup slots; season caps limit it.
const GAMES_PLAYED = "30";
const gamesSchema = z.number().int().nonnegative();
const responseSchema = z.object({
  seasonId: z.number(),
  scoringPeriodId: z.number().int(),
  teams: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string().min(1),
        abbrev: z.string(),
        points: z.number().finite(),
        valuesByStat: z.record(z.string(), z.number()).optional(),
      }),
    )
    .min(1),
  settings: z
    .object({
      rosterSettings: z.object({
        lineupSlotStatLimits: z.record(
          z.string(),
          z.object({ statId: z.number(), limitValue: z.number() }),
        ),
      }),
    })
    .optional(),
});
/** Season games caps keyed by ESPN lineup slot ID. */
function slotCaps(settings: z.infer<typeof responseSchema>["settings"]) {
  return Object.fromEntries(
    Object.entries(settings?.rosterSettings.lineupSlotStatLimits ?? {}).flatMap(
      ([slot, limit]) =>
        limit.statId === Number(GAMES_PLAYED) &&
        gamesSchema.positive().safeParse(limit.limitValue).success
          ? [[slot, limit.limitValue]]
          : [],
    ),
  );
}
async function getEspn(secretsPath: string, path: string): Promise<unknown> {
  let cookies = "";
  let cookieCount = 0;
  try {
    const secrets = await readFile(secretsPath, "utf8");
    const pairs = secrets.split("\n").flatMap((line) => {
      const match = line.trim().match(/^(espn_s2|swid)\s*=\s*(.*)$/i);
      if (!match) return [];
      const value = (match[2] ?? "").replace(/^["']|["']$/g, "").trim();
      if (!value) return [];
      const key = match[1]?.toLowerCase() === "swid" ? "SWID" : "espn_s2";
      return [`${key}=${value}`];
    });
    cookieCount = new Set(pairs.map((pair) => pair.split("=")[0])).size;
    cookies = pairs.join("; ");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("Cannot read ESPN credential file.");
  }
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/${path}`;
  const response = await fetch(url, {
    headers: { Cookie: cookies, "User-Agent": "ProgressTracker/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 401 && cookieCount === 0)
      throw new Error(
        `ESPN returned HTTP 401 with no cookies sent. Add espn_s2 and SWID to ${secretsPath}.`,
      );
    throw new Error(
      `ESPN returned HTTP ${response.status}. Check the server-side ESPN cookies if access has expired.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error("ESPN returned an invalid response.");
  }
}
/** Cookie-file status for startup logs. Reports key names only, never values. */
export async function espnSecretsStatus(
  secretsPath: string,
): Promise<string> {
  let secrets: string;
  try {
    secrets = await readFile(secretsPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return `missing (${secretsPath})`;
    return `unreadable (${secretsPath})`;
  }
  const keys = new Set(
    secrets.split("\n").flatMap((line) => {
      const match = line.trim().match(/^(espn_s2|swid)\s*=\s*(.+)$/i);
      return match?.[1] ? [match[1].toLowerCase()] : [];
    }),
  );
  if (!keys.size) return `empty (${secretsPath})`;
  const missing = ["espn_s2", "swid"].filter((key) => !keys.has(key));
  return missing.length
    ? `partial (missing ${missing.join(", ")}) (${secretsPath})`
    : `found espn_s2 + SWID (${secretsPath})`;
}
export async function fetchEspn(
  leagueId: number,
  season: number,
  secretsPath: string,
) {
  const parsed = responseSchema.safeParse(
    await getEspn(
      secretsPath,
      `${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mSettings`,
    ),
  );
  if (!parsed.success)
    throw new Error(
      "ESPN response is missing valid team totals. Existing history has been preserved.",
    );
  if (parsed.data.seasonId !== season)
    throw new Error(
      "ESPN returned a different season. Existing history has been preserved.",
    );
  const ids = parsed.data.teams.map((team) => team.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("ESPN returned duplicate team IDs.");
  const caps = slotCaps(parsed.data.settings);
  const total = Object.values(caps).reduce((sum, cap) => sum + cap, 0);
  return {
    seasonId: parsed.data.seasonId,
    scoringPeriodId: parsed.data.scoringPeriodId,
    slotCaps: caps,
    gamesCap: total > 0 ? total : null,
    teams: parsed.data.teams.map(({ valuesByStat, ...team }) => ({
      ...team,
      games: gamesSchema.safeParse(valuesByStat?.[GAMES_PLAYED]).data ?? null,
    })),
  };
}
const rosterSchema = z.object({
  seasonId: z.number(),
  teams: z
    .array(
      z.object({
        id: z.number().int(),
        roster: z.object({
          entries: z.array(
            z.object({
              lineupSlotId: z.number().int(),
              playerPoolEntry: z.object({
                player: z.object({
                  stats: z
                    .array(
                      z.object({
                        scoringPeriodId: z.number().int(),
                        statSourceId: z.number(),
                        statSplitTypeId: z.number(),
                        appliedTotal: z.number().finite().optional(),
                        stats: z.record(z.string(), z.number()).optional(),
                      }),
                    )
                    .optional(),
                }),
              }),
            }),
          ),
        }),
      }),
    )
    .min(1),
});
/** ESPN's bench lineup slot: its points never count toward a team's total. */
export const BENCH_SLOT = 7;
export type RoleDay = {
  period: number;
  teamId: number;
  slot: number;
  points: number;
  games: number;
};
/**
 * Points and games each team earned in each requested lineup slot on one scoring day.
 * Every team and slot gets a row, so days without games are still recorded.
 */
export async function fetchRoleDay(
  leagueId: number,
  season: number,
  secretsPath: string,
  period: number,
  slots: number[],
): Promise<RoleDay[]> {
  const parsed = rosterSchema.safeParse(
    await getEspn(
      secretsPath,
      `${season}/segments/0/leagues/${leagueId}?view=mRoster&scoringPeriodId=${period}`,
    ),
  );
  if (!parsed.success || parsed.data.seasonId !== season)
    throw new Error(
      `ESPN returned an invalid lineup for scoring day ${period}.`,
    );
  return parsed.data.teams.flatMap((team) => {
    const totals = new Map(
      slots.map((slot) => [slot, { points: 0, games: 0 }]),
    );
    for (const entry of team.roster.entries) {
      const total = totals.get(entry.lineupSlotId);
      // Actual (source 0) single-day (split 5) stats for this scoring day.
      const day = entry.playerPoolEntry.player.stats?.find(
        (stat) =>
          stat.scoringPeriodId === period &&
          stat.statSourceId === 0 &&
          stat.statSplitTypeId === 5,
      );
      if (!total || !day) continue;
      const games = gamesSchema.safeParse(day.stats?.[GAMES_PLAYED] ?? 0);
      if (day.appliedTotal === undefined || !games.success)
        throw new Error(
          `ESPN returned incomplete player stats for scoring day ${period}.`,
        );
      total.points += day.appliedTotal;
      total.games += games.data;
    }
    return [...totals].map(([slot, total]) => ({
      period,
      teamId: team.id,
      slot,
      points: Math.round(total.points * 100) / 100,
      games: total.games,
    }));
  });
}
const scheduleSchema = z.object({
  settings: z.object({
    proTeams: z
      .array(
        z.object({
          proGamesByScoringPeriod: z
            .record(
              z.string(),
              z.array(
                z.object({
                  date: z.number(),
                  scoringPeriodId: z.number().int().positive(),
                }),
              ),
            )
            .optional(),
        }),
      )
      .min(1),
  }),
});
export type Schedule = {
  /** Montreal date of scoring day 1; scoring day p is p - 1 days later. */
  start: string;
  finalPeriod: number;
  /** NHL team-games on each scoring day. */
  nhlGames: Record<string, number>;
};
export async function fetchSchedule(
  season: number,
  secretsPath: string,
): Promise<Schedule> {
  const parsed = scheduleSchema.safeParse(
    await getEspn(secretsPath, `${season}?view=proTeamSchedules_wl`),
  );
  if (!parsed.success)
    throw new Error("ESPN returned an invalid NHL schedule.");
  const nhlGames: Record<string, number> = {};
  // Late games can start after midnight in Montreal, so take the most common start date.
  const starts = new Map<string, number>();
  const montreal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montreal",
  });
  for (const team of parsed.data.settings.proTeams)
    for (const games of Object.values(team.proGamesByScoringPeriod ?? {}))
      for (const game of games) {
        nhlGames[game.scoringPeriodId] =
          (nhlGames[game.scoringPeriodId] ?? 0) + 1;
        const [year, month, day] = montreal
          .format(new Date(game.date))
          .split("-")
          .map(Number);
        const start = new Date(
          Date.UTC(year!, month! - 1, day! - game.scoringPeriodId + 1),
        )
          .toISOString()
          .slice(0, 10);
        starts.set(start, (starts.get(start) ?? 0) + 1);
      }
  const start = [...starts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const periods = Object.keys(nhlGames).map(Number);
  if (start === undefined || !periods.length)
    throw new Error("ESPN returned an empty NHL schedule.");
  return { start, finalPeriod: Math.max(...periods), nhlGames };
}
