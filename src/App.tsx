import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Download,
  Eye,
  Crosshair,
  Flag,
  Gauge,
  RefreshCw,
  Search,
  TrendingUp,
  Trophy,
} from "lucide-react";
import RoleBreakdown from "@/components/role-breakdown";
import SeasonOutlook from "@/components/season-outlook";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  dashboardSchema,
  type Dashboard,
  type Observation,
} from "@/lib/schema";
import {
  dailyObservations,
  localDay,
  pointsPerGame,
  rankAt,
  rateRankAt,
  seriesValue,
  teamColor,
  type Metric,
} from "@/lib/metrics";
import {
  dayObservations,
  formAt,
  periodDate,
  rolePace,
  simulateSeason,
} from "@/lib/insights";
const ProgressChart = lazy(() => import("@/components/progress-chart"));
const number = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
function points(value: number | null | undefined) {
  return value == null ? "—" : number.format(value);
}
const whole = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
function percent(value: number) {
  return value > 0 && value < 0.005
    ? "<1%"
    : value < 1 && value > 0.995
      ? ">99%"
      : `${Math.round(value * 100)}%`;
}
function signed(value: number | null | undefined) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${points(value)}`;
}
const metricSchema = z.enum(["total", "rate", "form", "change", "gap", "rank"]);
const preferenceSchema = z.object({
  hidden: z.array(z.number()),
  baseline: z.string(),
  metric: metricSchema,
});
const STORAGE_KEY = "progress-tracker:v2";
function preferences(fallbackBaseline = "3"): z.infer<typeof preferenceSchema> {
  try {
    return preferenceSchema.parse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ""),
    );
  } catch {
    return {
      hidden: [],
      baseline: fallbackBaseline,
      metric: "total" satisfies Metric,
    };
  }
}
const metricLabels: Record<Metric, string> = {
  total: "Cumulative points",
  rate: "Points per game",
  form: "Points per game, last 7 days",
  change: "Point change",
  gap: "Point differential",
  rank: "League rank",
};
const EMPTY_OBSERVATIONS: Observation[] = [];
type Sort =
  "rank" | "name" | "points" | "games" | "rate" | "form" | "change" | "gap";
export default function App() {
  const [openedAt] = useState(() => Date.now());
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [settings, setSettings] = useState(() => preferences());
  const [query, setQuery] = useState("");
  const [focusedTeamId, setFocusedTeamId] = useState<number | null>(null);
  const [range, setRange] = useState("season");
  const [resolution, setResolution] = useState("daily");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState<{ key: Sort; descending: boolean }>({
    key: "rank",
    descending: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/dashboard", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load the local tracker.");
        const payload: unknown = await response.json();
        setData(dashboardSchema.parse(payload));
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Could not load data.");
      }
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Controls still work when the browser disables persistent storage.
    }
  }, [settings]);
  async function sync() {
    setSyncing(true);
    setSyncResult("idle");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const refreshed = await fetch("/api/dashboard");
      if (!refreshed.ok) throw new Error("Could not reload tracker data.");
      const payload: unknown = await refreshed.json();
      setData(dashboardSchema.parse(payload));
      if (!response.ok)
        throw new Error("ESPN sync failed. Saved history is still available.");
      setError(null);
      setSyncResult("success");
    } catch (err) {
      setSyncResult("error");
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }
  const teams = data?.teams ?? [];
  // Server-configured default team (TRACKED_TEAM_ID). Falls back to team 3
  // for backwards compatibility, then to the first team in the league.
  const trackedTeamId =
    data?.trackedTeamId ??
    (teams.some((team) => team.id === 3) ? 3 : (teams[0]?.id ?? null));
  const trackedTeam = teams.find((team) => team.id === trackedTeamId);
  // Apply the server default on first load: fresh browsers (no stored
  // preferences) start with the tracked team as baseline and highlight.
  // Stored baselines for teams that no longer exist fall back the same way.
  useEffect(() => {
    if (!data || trackedTeamId == null) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored == null) {
      setSettings((old) =>
        old.baseline === "3" && trackedTeamId !== 3
          ? { ...old, baseline: String(trackedTeamId) }
          : old,
      );
      setFocusedTeamId((old) => (old === null ? trackedTeamId : old));
    }
  }, [data, trackedTeamId]);
  useEffect(() => {
    if (!teams.length || trackedTeamId == null) return;
    if (!teams.some((team) => team.id === Number(settings.baseline))) {
      const fallback = teams.some((team) => team.id === trackedTeamId)
        ? String(trackedTeamId)
        : String(teams[0]!.id);
      setSettings((old) => ({ ...old, baseline: fallback }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.length, trackedTeamId]);
  const baseline = Number(settings.baseline);
  const baselineTeam = teams.find((team) => team.id === baseline);
  const visible = teams.filter((team) => !settings.hidden.includes(team.id));
  const graphVisible = visible;
  const searched = teams.filter((team) =>
    `${team.name} ${team.abbrev}`.toLowerCase().includes(query.toLowerCase()),
  );
  const allObservations = data?.observations ?? EMPTY_OBSERVATIONS;
  // Completed scoring days give exact, gap-free daily totals; captures fill in otherwise.
  const daySeries = useMemo(() => {
    if (!data?.schedule) return EMPTY_OBSERVATIONS;
    const days = dayObservations(data.roles, data.schedule.start);
    if (data.live && settings.metric !== "form")
      days.push({
        ...data.live,
        timestamp: `${periodDate(data.schedule.start, data.live.period)}T16:00:00.000Z`,
      });
    return days;
  }, [data, settings.metric]);
  const usesDays =
    daySeries.length > 0 &&
    (settings.metric === "form" || resolution === "daily");
  const observations = useMemo(
    () =>
      usesDays
        ? daySeries
        : resolution === "daily"
          ? dailyObservations(allObservations)
          : allObservations,
    [allObservations, daySeries, resolution, usesDays],
  );
  const outlook = useMemo(
    () =>
      data
        ? simulateSeason(
            data.roles,
            data.teams.map((team) => team.id),
          )
        : null,
    [data],
  );
  const cutoff =
    range === "7" || range === "30"
      ? localDay(
          new Date(
            (data?.lastAttempt ? Date.parse(data.lastAttempt) : openedAt) -
              (Number(range) - 1) * 86_400_000,
          ).toISOString(),
        )
      : "";
  const rows = observations.flatMap((observation, index) => {
    const day = localDay(observation.timestamp);
    if (
      (cutoff && day < cutoff) ||
      (range === "custom" && ((start && day < start) || (end && day > end)))
    )
      return [];
    const row: Record<string, string | number | null> = {
      timestamp: observation.timestamp,
    };
    for (const team of teams)
      row[`team-${team.id}`] = seriesValue(
        settings.metric,
        observations,
        index,
        team,
        baseline,
      );
    return [row];
  });
  const latest = allObservations.at(-1);
  const first = allObservations[0];
  const selectedLast = observations.find(
    (row) => row.timestamp === rows.at(-1)?.timestamp,
  );
  const selectedFirst = observations.find(
    (row) => row.timestamp === rows[0]?.timestamp,
  );
  const endpoint = rows.at(-1);
  const endpointValues = teams.flatMap((team) => {
    const value = endpoint?.[`team-${team.id}`];
    return typeof value === "number" ? [value] : [];
  });
  const endDay = endpoint ? localDay(String(endpoint.timestamp)) : null;
  const formIndex =
    endDay === null
      ? -1
      : daySeries.findLastIndex((day) => localDay(day.timestamp) <= endDay);
  const sidebarTeams = searched
    .map((team) => {
      const value = endpoint?.[`team-${team.id}`];
      return {
        team,
        value:
          typeof value === "number" && Number.isFinite(value) ? value : null,
        // Rate views rank by the shown value; other views show the points rank.
        rank:
          settings.metric === "rate" || settings.metric === "form"
            ? typeof value === "number"
              ? 1 + endpointValues.filter((other) => other > value).length
              : null
            : selectedLast
              ? rankAt(selectedLast, team.id)
              : null,
      };
    })
    .sort((a, b) => {
      if (a.value === null) return b.value === null ? a.team.id - b.team.id : 1;
      if (b.value === null) return -1;
      return (
        (settings.metric === "rank" ? a.value - b.value : b.value - a.value) ||
        a.team.id - b.team.id
      );
    });
  const lastScoringDay = data?.roles.days.at(-1);
  const previousDay = dailyObservations(allObservations).at(-2);
  const trackedOutlook =
    trackedTeamId != null ? outlook?.get(trackedTeamId) : undefined;
  const leader = latest
    ? [...teams].sort(
        (a, b) => (latest.points[b.id] ?? 0) - (latest.points[a.id] ?? 0),
      )[0]
    : undefined;
  const leaderGap =
    latest && trackedTeam && leader
      ? (latest.points[trackedTeam.id] ?? 0) - (latest.points[leader.id] ?? 0)
      : null;
  const trackedPace =
    data && trackedTeamId != null ? rolePace(data.roles, trackedTeamId) : null;
  const trackedRate =
    latest && trackedTeam ? pointsPerGame(latest, trackedTeam.id) : null;
  const trackedRateRank =
    latest && trackedTeam ? rateRankAt(latest, trackedTeam.id) : null;
  const table = searched
    .map((team) => {
      const total = selectedLast?.points[team.id];
      const before = selectedFirst?.points[team.id];
      const reference = selectedLast?.points[baseline];
      const rate = selectedLast ? pointsPerGame(selectedLast, team.id) : null;
      return {
        team,
        rank: selectedLast ? rankAt(selectedLast, team.id) : null,
        points: total ?? null,
        games: selectedLast?.games[team.id] ?? null,
        rate,
        form: formIndex < 0 ? null : formAt(daySeries, formIndex, team.id),
        change:
          rows.length < 2 || total === undefined || before === undefined
            ? null
            : total - before,
        gap:
          total === undefined || reference === undefined
            ? null
            : total - reference,
      };
    })
    .sort((a, b) => {
      const difference =
        sort.key === "name"
          ? a.team.name.localeCompare(b.team.name)
          : (a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity);
      return (
        (sort.descending ? -difference : difference) || a.team.id - b.team.id
      );
    });
  function toggle(id: number) {
    setSettings((old) => ({
      ...old,
      hidden: old.hidden.includes(id)
        ? old.hidden.filter((teamId) => teamId !== id)
        : [...old.hidden, id],
    }));
  }
  function focusTeam(id: number | null) {
    setFocusedTeamId(id);
    if (id !== null)
      setSettings((old) => ({
        ...old,
        hidden: old.hidden.filter((teamId) => teamId !== id),
      }));
  }
  function changeSort(key: Sort) {
    setSort((old) => ({
      key,
      descending:
        old.key === key ? !old.descending : key !== "rank" && key !== "name",
    }));
  }
  function shortDate(value: string) {
    return new Date(value).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "America/Montreal",
    });
  }
  return (
    <div className="app-shell">
      <aside className="rail">
        <a href="/" className="brand-mark" aria-label="Progress tracker home">
          <TrendingUp size={24} />
        </a>
        <div className="rail-line" />
        <div className="rail-active" title="Season progress">
          <Activity size={21} />
        </div>
        <span className="rail-season">26 / 27</span>
        <span className="rail-bottom">PT</span>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            HOCKEY POOL <ChevronRight size={12} />
            <span>SEASON PROGRESS</span>
          </div>
          <div className="topbar-actions">
            <div className="connection">
              <span
                className={`status-dot ${data?.error || data?.liveError || error ? "warning" : ""}`}
              />
              {data?.error
                ? "Sync needs attention"
                : data?.lastSuccess
                  ? data.liveError
                    ? "Live scores need attention"
                    : data.live
                      ? "Live scores · provisional"
                      : "ESPN connected"
                  : "Connecting to ESPN"}
            </div>
            <ThemeToggle />
          </div>
        </header>
        <section className="page-heading">
          <div>
            <h1>Season progress</h1>
            <p>Track the season. See where every team stands.</p>
          </div>
          <div className="heading-actions">
            <span className="season-label">
              {data ? `${data.season - 1} / ${data.season}` : "2026 / 2027"}
            </span>
            <Button variant="outline" asChild>
              <a href="/api/export.csv">
                <Download size={15} />
                Export CSV
              </a>
            </Button>
            <Button
              onClick={() => void sync()}
              disabled={syncing}
              className={`sync-button ${syncing ? "is-syncing" : syncResult === "success" ? "sync-complete" : ""}`}
              aria-busy={syncing}
            >
              {syncResult === "success" && !syncing ? (
                <Check size={15} />
              ) : (
                <RefreshCw size={15} className={syncing ? "spin" : ""} />
              )}
              {syncing
                ? "Syncing…"
                : syncResult === "success"
                  ? "Synced · Sync again"
                  : "Sync ESPN"}
            </Button>
            <span className="sr-only" role="status">
              {syncing
                ? "Syncing ESPN data."
                : syncResult === "success"
                  ? "ESPN sync complete."
                  : syncResult === "error"
                    ? "ESPN sync failed."
                    : ""}
            </span>
          </div>
        </section>
        {error || data?.error || data?.liveError ? (
          <div className="alert" role="alert">
            {data?.error ?? error ?? data?.liveError}{" "}
            {data?.lastSuccess ? "Showing the last saved data." : ""}
          </div>
        ) : null}
        <section className="stats-grid">
          <div className="stat">
            <div className="stat-label">
              <Trophy size={15} />
              LEAGUE LEADER
            </div>
            <div className="stat-number">
              {points(leader && latest ? latest.points[leader.id] : null)}
              <span>pts</span>
            </div>
            <div className="stat-foot">
              <span
                className="team-dot"
                style={{
                  background: leader ? teamColor(leader.id) : undefined,
                }}
              />
              {leader?.name ?? "Awaiting first sync"}
            </div>
          </div>
          <div className="stat astra-stat">
            <div className="stat-label">
              <Flag size={15} />
              {trackedTeam ? `${trackedTeam.name.toUpperCase()}’S POSITION` : "TRACKED TEAM’S POSITION"}<Badge variant="outline">YOUR TEAM</Badge>
            </div>
            <div className="stat-number">
              {latest && trackedTeam ? `#${rankAt(latest, trackedTeam.id)}` : "—"}
              <span>/ {teams.length || 14}</span>
            </div>
            <div className="stat-foot">
              {points(leaderGap == null ? null : Math.abs(leaderGap))} points
              from the lead
              {trackedOutlook ? ` · ${percent(trackedOutlook.win)} to win` : ""}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">
              <TrendingUp size={15} />
              {lastScoringDay
                ? `${trackedTeam ? trackedTeam.name.toUpperCase() : "TRACKED TEAM"}’S LAST DAY`
                : `${trackedTeam ? trackedTeam.name.toUpperCase() : "TRACKED TEAM"}’S DAILY CHANGE`}
            </div>
            <div className="stat-number">
              {signed(
                lastScoringDay && trackedTeamId != null
                  ? (lastScoringDay.points[trackedTeamId] ?? null)
                  : latest && previousDay && trackedTeam
                    ? (latest.points[trackedTeam.id] ?? 0) -
                      (previousDay.points[trackedTeam.id] ?? 0)
                    : null,
              )}
              <span>pts</span>
            </div>
            <div className="stat-foot">
              {lastScoringDay && data?.schedule && trackedTeamId != null
                ? `${shortDate(`${periodDate(data.schedule.start, lastScoringDay.period)}T16:00:00.000Z`)} · ${lastScoringDay.games[trackedTeamId] ?? 0} GP`
                : previousDay
                  ? "Since the previous tracked day"
                  : "Available after a second tracked day"}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">
              <Gauge size={15} />
              {trackedTeam ? `${trackedTeam.name.toUpperCase()}’S POINTS / GAME` : "TRACKED POINTS / GAME"}
            </div>
            <div className="stat-number">
              {points(trackedRate)}
              <span>pts/GP</span>
            </div>
            <div className="stat-foot">
              {trackedRate === null || trackedRateRank === null
                ? "Available once ESPN reports games played"
                : `#${trackedRateRank} in the league${trackedPace === null ? "" : ` · ${whole.format(trackedPace)}-pt pace`}`}
            </div>
          </div>
        </section>
        <div className="workspace">
          <section className="chart-panel panel">
            <div className="panel-heading">
              <div>
                <h2>
                  Point progression
                  <span className="small-counter">{visible.length} teams</span>
                </h2>
              </div>
              <div className="range-control">
                <Select value={range} onValueChange={setRange}>
                  <SelectTrigger aria-label="Date range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="season">Full season</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="custom">Custom dates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="chart-toolbar">
              <Tabs
                value={settings.metric}
                onValueChange={(value) => {
                  const parsed = metricSchema.safeParse(value);
                  if (parsed.success)
                    setSettings((old) => ({ ...old, metric: parsed.data }));
                }}
              >
                <TabsList>
                  <TabsTrigger value="total">Total points</TabsTrigger>
                  <TabsTrigger value="rate">Pts / GP</TabsTrigger>
                  <TabsTrigger value="form">Form</TabsTrigger>
                  <TabsTrigger value="change">Point change</TabsTrigger>
                  <TabsTrigger value="gap">Differential</TabsTrigger>
                  <TabsTrigger value="rank">Rank</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select
                value={resolution}
                onValueChange={setResolution}
                disabled={settings.metric === "form"}
              >
                <SelectTrigger
                  aria-label="Chart resolution"
                  className="resolution"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="captures">Every capture</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {range === "custom" ? (
              <div className="custom-dates">
                <label>
                  From
                  <input
                    type="date"
                    value={start}
                    max={end || undefined}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={end}
                    min={start || undefined}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <div className="chart-meta">
              <span>
                {metricLabels[settings.metric]}
                {settings.metric === "gap"
                  ? ` vs. ${baselineTeam?.name ?? "selected team"}`
                  : ""}
              </span>
              <span>
                {rows.length
                  ? `${shortDate(String(rows[0]?.timestamp))} — ${shortDate(String(rows.at(-1)?.timestamp))}`
                  : "No captures in this range"}
              </span>
            </div>
            <div
              className={`chart-area ${rows.length === 1 && settings.metric !== "change" ? "single-snapshot" : ""}`}
            >
              {!data ? (
                <div className="empty-state">
                  <RefreshCw className="spin" />
                  <h3>Loading your league…</h3>
                </div>
              ) : !rows.length ||
                !graphVisible.length ||
                ((settings.metric === "change" ||
                  settings.metric === "rate" ||
                  settings.metric === "form") &&
                  rows.every((row) =>
                    graphVisible.every(
                      (team) => row[`team-${team.id}`] === null,
                    ),
                  )) ? (
                <div className="empty-state">
                  <Activity />
                  <h3>
                    {!graphVisible.length
                      ? "The ice is yours."
                      : rows.length && settings.metric === "rate"
                        ? "Waiting for games played."
                        : "A little more history to go."}
                  </h3>
                  <p>
                    {!graphVisible.length
                      ? "Select a team to bring it back into view."
                      : !rows.length
                        ? "No recorded data for this range. Try the full season."
                        : settings.metric === "rate"
                          ? "Points per game appears once ESPN reports games played for these captures."
                          : settings.metric === "form"
                            ? "Form appears after ESPN completes a scoring day with games."
                            : "Point changes appear after two tracked days. Choose Every capture to compare intraday updates."}
                  </p>
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="empty-state">
                      <RefreshCw className="spin" />
                      <p>Loading chart…</p>
                    </div>
                  }
                >
                  <ProgressChart
                    rows={rows}
                    metric={settings.metric}
                    resolution={resolution}
                    visible={graphVisible}
                    teamCount={teams.length}
                    focusedTeamId={focusedTeamId}
                    trackedTeamId={trackedTeamId}
                    onFocusTeam={focusTeam}
                  />
                </Suspense>
              )}
            </div>
            <div className="chart-footer">
              <span>
                <span className="status-dot" />
                {rows.length === 1
                  ? "First snapshot saved. Your season curve grows with each update."
                  : settings.metric === "rate"
                    ? "Season points divided by games played in active lineup slots."
                    : settings.metric === "form"
                      ? "Points per game over each team’s last 7 completed scoring days."
                      : settings.metric === "change" && usesDays
                        ? "Points scored on each completed scoring day."
                        : settings.metric === "change"
                          ? resolution === "daily"
                            ? "Changes since the preceding tracked day; gaps can span multiple days."
                            : "Changes since the preceding capture."
                          : "Hover to compare teams at any recorded point."}
              </span>
              <span>POINTS, NOT GUESSWORK</span>
            </div>
          </section>
          <aside className="team-panel panel">
            <div className="team-panel-header">
              <h2>
                The league <span className="small-counter">{teams.length}</span>
              </h2>
              <p>{metricLabels[settings.metric]} · range end</p>
            </div>
            <div className="search">
              <Search size={15} />
              <input
                aria-label="Search teams"
                placeholder="Find a team…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="team-bulk">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSettings((old) => ({
                    ...old,
                    hidden: [],
                  }))
                }
              >
                Show all
              </Button>
              <span>/</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSettings((old) => ({
                    ...old,
                    hidden: teams.map((team) => team.id),
                  }))
                }
              >
                Hide all
              </Button>
              <span className="visible-count">
                <Eye size={12} />
                {visible.length}
              </span>
            </div>
            <div className="team-list">
              {sidebarTeams.map(({ team, value, rank }) => (
                <div
                  className={`team-option ${team.id === trackedTeamId ? "team-option-astra" : ""} ${focusedTeamId === team.id ? "team-focused" : ""} ${settings.hidden.includes(team.id) ? "team-hidden" : ""}`}
                  key={team.id}
                >
                  <Checkbox
                    id={`team-visibility-${team.id}`}
                    checked={!settings.hidden.includes(team.id)}
                    onCheckedChange={() => toggle(team.id)}
                    aria-label={`Show ${team.name}`}
                    style={{
                      borderColor: teamColor(team.id),
                      backgroundColor: settings.hidden.includes(team.id)
                        ? "transparent"
                        : teamColor(team.id),
                      color: "var(--card)",
                    }}
                  />
                  <span
                    className="team-option-rank"
                    aria-label={`${settings.metric === "rate" || settings.metric === "form" ? "Points-per-game rank" : "League rank"} ${rank ?? "unavailable"}`}
                  >
                    {rank == null ? "—" : `#${rank}`}
                  </span>
                  <label
                    className="team-option-text"
                    htmlFor={`team-visibility-${team.id}`}
                  >
                    <span className="team-option-name" title={team.name}>
                      {team.name}
                      {team.id === trackedTeamId ? (
                        <span className="you-tag">YOU</span>
                      ) : null}
                    </span>
                    <small>{team.abbrev}</small>
                  </label>
                  <span className="team-option-points">
                    {settings.metric === "rank"
                      ? value == null
                        ? "—"
                        : `#${value}`
                      : settings.metric === "total" ||
                          settings.metric === "rate" ||
                          settings.metric === "form"
                        ? points(value)
                        : signed(value)}
                    {settings.metric === "rank" ? null : (
                      <small>
                        {settings.metric === "rate" ||
                        settings.metric === "form"
                          ? "pts/GP"
                          : "pts"}
                      </small>
                    )}
                  </span>
                  <button
                    type="button"
                    className="team-focus-button"
                    aria-label={`${focusedTeamId === team.id ? "Stop highlighting" : "Highlight"} ${team.name} in chart`}
                    aria-pressed={focusedTeamId === team.id}
                    onClick={() =>
                      focusTeam(focusedTeamId === team.id ? null : team.id)
                    }
                    title={`${focusedTeamId === team.id ? "Stop highlighting" : "Highlight"} ${team.name} in chart`}
                  >
                    <Crosshair size={14} />
                  </button>
                </div>
              ))}
              {!searched.length ? (
                <p className="no-results">No teams found.</p>
              ) : null}
            </div>
            <div className="baseline-control">
              <label>DIFFERENTIAL BASELINE</label>
              <Select
                value={settings.baseline}
                onValueChange={(value) =>
                  setSettings((old) => ({ ...old, baseline: value }))
                }
              >
                <SelectTrigger aria-label="Differential baseline">
                  <SelectValue placeholder="Choose a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="only-astra"
                disabled={trackedTeamId == null}
                onClick={() => {
                  if (trackedTeamId == null) return;
                  const id = trackedTeamId;
                  setFocusedTeamId(id);
                  setSettings((old) => ({
                    ...old,
                    hidden: teams
                      .filter((team) => team.id !== id)
                      .map((team) => team.id),
                  }));
                }}
              >
                <Flag size={13} />
                Focus on {trackedTeam?.name ?? "tracked team"}
              </Button>
            </div>
          </aside>
        </div>
        <section className="standings panel league-standings">
          <div className="standings-heading">
            <div>
              <h2>League standings</h2>
              <p className="mobile-table-hint">Swipe across for more stats</p>
            </div>
            <span>At the end of your selected range</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      ["rank", "RANK"],
                      ["name", "TEAM"],
                      ["points", "TOTAL POINTS"],
                      ["games", "GP", "Games played in active lineup slots"],
                      ["rate", "PTS / GP", "Points per game played"],
                      [
                        "form",
                        "FORM",
                        "Points per game over the last 7 completed scoring days",
                      ],
                      ["change", "RANGE CHANGE"],
                      ["gap", `VS. ${baselineTeam?.abbrev ?? "BASELINE"}`],
                    ] satisfies ([Sort, string] | [Sort, string, string])[]
                  ).map(([key, label, description]) => (
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
                      <button
                        onClick={() => changeSort(key)}
                        title={description}
                      >
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
                  <th>CHART</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr
                    key={row.team.id}
                    className={row.team.id === trackedTeamId ? "astra-row" : ""}
                  >
                    <td>
                      <span className="rank-number">{row.rank ?? "—"}</span>
                    </td>
                    <td>
                      <div className="table-team">
                        <span
                          className="team-monogram"
                          style={{
                            color: teamColor(row.team.id),
                            background: `color-mix(in srgb, ${teamColor(row.team.id)} 12%, var(--card))`,
                          }}
                          aria-hidden="true"
                        >
                          {row.team.abbrev.slice(0, 3)}
                        </span>
                        <span className="table-team-name">{row.team.name}</span>
                        {row.team.id === trackedTeamId ? (
                          <span className="you-tag">YOU</span>
                        ) : null}
                        <small>{row.team.abbrev}</small>
                      </div>
                    </td>
                    <td className="numeric">{points(row.points)}</td>
                    <td className="numeric">{row.games ?? "—"}</td>
                    <td className="numeric">{points(row.rate)}</td>
                    <td className="numeric">{points(row.form)}</td>
                    <td
                      className={`numeric ${row.change != null && row.change > 0 ? "positive" : ""}`}
                    >
                      {signed(row.change)}
                    </td>
                    <td
                      className={`numeric ${row.gap != null && row.gap < 0 ? "negative" : row.gap != null && row.gap > 0 ? "positive" : ""}`}
                    >
                      {signed(row.gap)}
                    </td>
                    <td>
                      <button
                        className="table-visibility"
                        onClick={() => toggle(row.team.id)}
                        aria-pressed={!settings.hidden.includes(row.team.id)}
                        aria-label={`${settings.hidden.includes(row.team.id) ? "Show" : "Hide"} ${row.team.name} in chart`}
                      >
                        {settings.hidden.includes(row.team.id) ? (
                          "Hidden"
                        ) : (
                          <>
                            <Check size={12} />
                            Visible
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!table.length ? (
              <p className="no-results">
                No standings available for this selection.
              </p>
            ) : null}
          </div>
        </section>
        {data ? (
          <>
            <SeasonOutlook
              teams={searched}
              roles={data.roles}
              outlook={outlook}
              trackedTeamId={trackedTeamId}
            />
            <RoleBreakdown
              teams={searched}
              roles={data.roles}
              schedule={data.schedule}
              error={data.rolesError}
              trackedTeamId={trackedTeamId}
            />
          </>
        ) : null}
        <footer className="page-footer">
          <span>
            PROGRESS TRACKER <span className="footer-slash">/</span> League{" "}
            {data?.leagueId ?? "918256829"}
          </span>
          <span>
            {first
              ? `${dailyObservations(allObservations).length} tracked days since ${shortDate(first.timestamp)}`
              : "History begins with the first live sync"}{" "}
            <span className="footer-slash">·</span>{" "}
            {data?.lastSuccess
              ? `Last synced ${new Date(data.lastSuccess).toLocaleString("en-CA", { timeZone: "America/Montreal" })} ET`
              : "Waiting for first sync"}{" "}
            <span className="footer-slash">·</span>{" "}
            {(data?.intervalMinutes ?? 1440) === 1440
              ? "Auto-sync daily"
              : `Auto-sync every ${data?.intervalMinutes} min`}
          </span>
        </footer>
        <p className="data-note">
          Daily view uses each completed ESPN scoring day, summed from that
          day’s lineups and checked against ESPN’s official totals, plus a
          provisional current-day total from active players. Live scores refresh
          throughout the night and may change after ESPN corrections. Every
          capture includes the latest live total; live updates replace one
          snapshot instead of accumulating history. CSV exports contain official
          captures. Form, role breakdowns and outlook use completed days. GP
          counts games played in active lineup slots, which the season caps
          limit. Pace assumes each role keeps its points per game through its
          remaining capped games. Outlook odds come from simulated seasons and
          are estimates, not predictions.
        </p>
      </main>
    </div>
  );
}
