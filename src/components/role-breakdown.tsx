import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Dashboard, Team } from "@/lib/schema";
import { teamColor } from "@/lib/metrics";
import { seasonFraction } from "@/lib/insights";
// ESPN hockey lineup slots that carry a season games cap.
const slotNames: Record<string, [string, string]> = {
  "3": ["Forwards", "F"],
  "4": ["Defense", "D"],
  "5": ["Goalies", "G"],
  "6": ["Utility", "UTIL"],
};
// ESPN's bench slot; its points never count.
const BENCH = "7";
const decimal = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
type Props = {
  teams: Team[];
  roles: Dashboard["roles"];
  schedule: Dashboard["schedule"];
  error: string | null;
  trackedTeamId?: number | null;
};
export default function RoleBreakdown({
  teams,
  roles,
  schedule,
  error,
  trackedTeamId = null,
}: Props) {
  const slots = Object.keys(roles.caps).sort((a, b) => Number(a) - Number(b));
  const [sort, setSort] = useState<{ key: string; descending: boolean }>({
    key: slots[0] ?? "name",
    descending: true,
  });
  const rate = (teamId: number, slot: string) => {
    const total = roles.teams[teamId]?.[slot];
    return total && total.games ? total.points / total.games : null;
  };
  // Ranks use every team with a known rate, regardless of the search filter.
  const rank = (teamId: number, slot: string) => {
    const value = rate(teamId, slot);
    if (value === null) return null;
    return (
      1 +
      Object.keys(roles.teams).filter(
        (id) => (rate(Number(id), slot) ?? -Infinity) > value,
      ).length
    );
  };
  // Share of NHL games played so far: an even cap pace uses this share of each cap.
  const fraction =
    schedule && roles.through !== null
      ? seasonFraction(schedule, roles.through)
      : null;
  const capPace = (teamId: number, slot: string) => {
    if (fraction === null) return null;
    const games = roles.teams[teamId]?.[slot]?.games ?? 0;
    const expected = (roles.caps[slot] ?? 0) * fraction;
    const difference = Math.round(games - expected);
    // Within 10% of the target (at least one game) counts as on pace.
    return Math.abs(games - expected) <= Math.max(1, expected * 0.1)
      ? { text: "on pace", tone: "" }
      : difference < 0
        ? { text: `${-difference} behind pace`, tone: "negative" }
        : { text: `${difference} ahead of pace`, tone: "" };
  };
  const value = (teamId: number, key: string) =>
    key === BENCH
      ? (roles.teams[teamId]?.[BENCH]?.points ?? 0)
      : rate(teamId, key);
  const rows = [...teams].sort((a, b) => {
    if (sort.key === "name")
      return (
        (sort.descending ? -1 : 1) * a.name.localeCompare(b.name) || a.id - b.id
      );
    const left = value(a.id, sort.key);
    const right = value(b.id, sort.key);
    if (left === null) return right === null ? a.id - b.id : 1;
    if (right === null) return -1;
    return (sort.descending ? right - left : left - right) || a.id - b.id;
  });
  const trackedName =
    teams.find((team) => team.id === trackedTeamId)?.name ?? "Tracked team";
  const trackedRanks =
    trackedTeamId == null
      ? ""
      : slots
          .map(
            (slot) =>
              `${slotNames[slot]?.[1] ?? slot} ${rank(trackedTeamId, slot) === null ? "—" : `#${rank(trackedTeamId, slot)}`}`,
          )
          .join(" · ");
  function changeSort(key: string) {
    setSort((old) => ({
      key,
      descending: old.key === key ? !old.descending : key !== "name",
    }));
  }
  const headers: [string, string, string | undefined][] = [
    ["name", "TEAM", undefined],
    ...slots.map((slot): [string, string, string] => [
      slot,
      (slotNames[slot]?.[0] ?? `Slot ${slot}`).toUpperCase(),
      `Points per game in ${slotNames[slot]?.[1] ?? slot} slots · ${whole.format(roles.caps[slot] ?? 0)}-game season cap`,
    ]),
    [
      BENCH,
      "BENCH",
      "Points scored by benched players. With games caps, some benching is deliberate.",
    ],
  ];
  return (
    <section className="standings panel roles-panel">
      <div className="standings-heading">
        <div>
          <h2>Points per game by role</h2>
          <p className="roles-note">
            {roles.through === null
              ? "Available after ESPN completes the first scoring day."
              : `Season to date through scoring day ${roles.through}. Points and games count only while a player fills that lineup slot. Cap pace compares games played with an even share of each cap, weighted by the NHL schedule.`}
          </p>
          <p className="mobile-table-hint">Swipe across for more roles</p>
        </div>
        {roles.through === null ? null : (
          <span>
            <strong>{trackedName}</strong> {trackedRanks}
          </span>
        )}
      </div>
      {error ? (
        <div className="alert roles-alert" role="alert">
          {error}
        </div>
      ) : null}
      {slots.length && roles.through !== null ? (
        <div className="table-scroll">
          <table className="role-table">
            <thead>
              <tr>
                {headers.map(([key, label, description]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort.key === key
                        ? sort.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button onClick={() => changeSort(key)} title={description}>
                      {label}
                      {sort.key === key ? (
                        sort.descending ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={12} />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((team) => (
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
                  {slots.map((slot) => {
                    const total = roles.teams[team.id]?.[slot];
                    const perGame = rate(team.id, slot);
                    const place = rank(team.id, slot);
                    const pace = capPace(team.id, slot);
                    return (
                      <td key={slot} className="numeric">
                        <span
                          className={`role-rate ${place === 1 ? "role-best" : ""}`}
                        >
                          {perGame === null ? "—" : decimal.format(perGame)}
                        </span>
                        <small className="role-detail">
                          {place === null ? "" : `#${place} · `}
                          {decimal.format(total?.points ?? 0)} pts
                        </small>
                        <small className="role-detail">
                          {total?.games ?? 0} GP
                          {pace ? (
                            <>
                              {" · "}
                              <span className={pace.tone}>{pace.text}</span>
                            </>
                          ) : null}
                        </small>
                      </td>
                    );
                  })}
                  <td className="numeric">
                    <span className="role-rate">
                      {decimal.format(
                        roles.teams[team.id]?.[BENCH]?.points ?? 0,
                      )}
                    </span>
                    <small className="role-detail">
                      {roles.teams[team.id]?.[BENCH]?.games ?? 0}{" "}
                      {roles.teams[team.id]?.[BENCH]?.games === 1
                        ? "game"
                        : "games"}{" "}
                      on bench
                    </small>
                  </td>
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
