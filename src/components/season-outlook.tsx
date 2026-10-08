import type { Dashboard, Team } from "@/lib/schema";
import { rolePace, type Outlook } from "@/lib/insights";
import { teamColor } from "@/lib/metrics";
const decimal = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
function percent(value: number) {
  return value > 0 && value < 0.005
    ? "<1%"
    : value < 1 && value > 0.995
      ? ">99%"
      : `${Math.round(value * 100)}%`;
}
type Props = {
  teams: Team[];
  roles: Dashboard["roles"];
  outlook: Map<number, Outlook> | null;
  trackedTeamId?: number | null;
};
export default function SeasonOutlook({
  teams,
  roles,
  outlook,
  trackedTeamId = null,
}: Props) {
  const current = (teamId: number) =>
    Object.keys(roles.caps).reduce(
      (sum, slot) => sum + (roles.teams[teamId]?.[slot]?.points ?? 0),
      0,
    );
  const rows = teams
    .map((team) => ({
      team,
      points: current(team.id),
      pace: rolePace(roles, team.id),
      odds: outlook?.get(team.id) ?? null,
    }))
    .sort(
      (a, b) =>
        (b.odds?.win ?? 0) - (a.odds?.win ?? 0) ||
        (b.odds?.median ?? 0) - (a.odds?.median ?? 0) ||
        a.team.id - b.team.id,
    );
  const tracked = trackedTeamId != null ? outlook?.get(trackedTeamId) : undefined;
  const trackedName =
    teams.find((team) => team.id === trackedTeamId)?.name ?? "Tracked team";
  return (
    <section className="standings panel outlook-panel">
      <div className="standings-heading">
        <div>
          <h2>Season outlook</h2>
          <p className="roles-note">
            {outlook && roles.through !== null
              ? `4,000 simulated seasons from each role’s points per game through scoring day ${roles.through}. Teams fill their remaining capped games; early rates are blended with the league average.`
              : "The outlook appears once every role has completed games."}
          </p>
          <p className="mobile-table-hint">Swipe across for more stats</p>
        </div>
        {tracked ? (
          <span>
            <strong>{trackedName}</strong> {percent(tracked.win)} to win ·{" "}
            {percent(tracked.top3)} top 3
          </span>
        ) : null}
      </div>
      {outlook ? (
        <div className="table-scroll">
          <table className="outlook-table">
            <thead>
              <tr>
                <th>TEAM</th>
                <th title="Official points through the last completed scoring day">
                  POINTS
                </th>
                <th title="Each role’s points per game × its remaining capped games">
                  PACE
                </th>
                <th title="Median simulated final, with the 10th–90th percentile range">
                  LIKELY FINAL
                </th>
                <th>1ST</th>
                <th>TOP 3</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ team, points, pace, odds }) => (
                <tr
                  key={team.id}
                  className={team.id === trackedTeamId ? "astra-row" : ""}
                >
                  <td>
                    <div className="table-team">
                      <span
                        className="team-monogram"
                        style={{
                          color: teamColor(team.id),
                          background: `color-mix(in srgb, ${teamColor(team.id)} 12%, var(--card))`,
                        }}
                        aria-hidden="true"
                      >
                        {team.abbrev.slice(0, 3)}
                      </span>
                      <span className="table-team-name">{team.name}</span>
                      {team.id === trackedTeamId ? (
                        <span className="you-tag">YOU</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="numeric">{decimal.format(points)}</td>
                  <td className="numeric">
                    {pace === null ? "—" : whole.format(pace)}
                  </td>
                  <td className="numeric">
                    {odds ? (
                      <>
                        <span className="role-rate">
                          {whole.format(odds.median)}
                        </span>
                        <small className="role-detail">
                          {whole.format(odds.low)}–{whole.format(odds.high)}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {([odds?.win, odds?.top3] as const).map((value, index) => (
                    <td key={index} className="numeric">
                      {value === undefined ? (
                        "—"
                      ) : (
                        <span className="odds">
                          <span className="odds-bar" aria-hidden="true">
                            <span style={{ width: `${value * 100}%` }} />
                          </span>
                          {percent(value)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="no-results">No teams found.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
