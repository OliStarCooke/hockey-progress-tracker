import { z } from "zod";
export const teamSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  abbrev: z.string(),
});
export const observationSchema = z.object({
  timestamp: z.string(),
  period: z.number().int(),
  points: z.record(z.string(), z.number().finite()),
  // Games played in active lineup slots; absent when ESPN did not report it.
  games: z.record(z.string(), z.number().int().nonnegative()),
});
export const dashboardSchema = z.object({
  leagueId: z.number(),
  season: z.number(),
  trackedTeamId: z.number().int().nullable().optional().default(null),
  intervalMinutes: z.number(),
  gamesCap: z.number().int().positive().nullable(),
  teams: z.array(teamSchema),
  observations: z.array(observationSchema),
  live: observationSchema.nullable().optional().default(null),
  liveError: z.string().nullable().optional().default(null),
  // Season-to-date totals per ESPN lineup slot, summed from completed scoring days.
  roles: z.object({
    through: z.number().int().nullable(),
    caps: z.record(z.string(), z.number()),
    // Per-game standard deviation of points in each capped slot.
    sd: z.record(z.string(), z.number()),
    // Completed scoring days: capped-slot points and games, and bench points.
    days: z.array(
      z.object({
        period: z.number().int(),
        points: z.record(z.string(), z.number()),
        games: z.record(z.string(), z.number().int().nonnegative()),
        bench: z.record(z.string(), z.number()),
      }),
    ),
    teams: z.record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          points: z.number(),
          games: z.number().int().nonnegative(),
        }),
      ),
    ),
  }),
  rolesError: z.string().nullable(),
  schedule: z
    .object({
      start: z.string(),
      finalPeriod: z.number().int(),
      nhlGames: z.record(z.string(), z.number()),
    })
    .nullable(),
  lastAttempt: z.string().nullable(),
  lastSuccess: z.string().nullable(),
  error: z.string().nullable(),
});
export type Team = z.infer<typeof teamSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
