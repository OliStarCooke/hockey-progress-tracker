import {
  Bar,
  Customized,
  usePlotArea,
  useYAxisScale,
  type TooltipContentProps,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Team } from "@/lib/schema";
import { teamColor, type Metric } from "@/lib/metrics";
type Props = {
  rows: Record<string, string | number | null>[];
  metric: Metric;
  resolution: string;
  visible: Team[];
  teamCount: number;
  focusedTeamId?: number | null;
  trackedTeamId?: number | null;
  onFocusTeam?: (teamId: number | null) => void;
};
const format = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
function points(value: number) {
  return format.format(value);
}
function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Montreal",
  });
}
function EndpointLabels({
  rows,
  visible,
  metric,
  focusedTeamId,
  trackedTeamId,
}: Pick<Props, "rows" | "visible" | "metric" | "focusedTeamId" | "trackedTeamId">) {
  const area = usePlotArea();
  const scale = useYAxisScale();
  if (!area || !scale) return null;
  const last = rows.at(-1);
  const labels = visible
    .flatMap((team) => {
      const value = last?.[`team-${team.id}`];
      const y = typeof value === "number" ? scale(value) : undefined;
      return typeof value === "number" && typeof y === "number"
        ? [{ team, value, y, labelY: y }]
        : [];
    })
    .sort((a, b) => a.y - b.y || a.team.id - b.team.id);
  const spacing = Math.min(20, area.height / Math.max(1, labels.length));
  labels.forEach((label, index) => {
    label.labelY = Math.max(
      label.y,
      index === 0
        ? area.y + 4
        : (labels[index - 1]?.labelY ?? area.y) + spacing,
    );
  });
  for (let index = labels.length - 1; index >= 0; index--) {
    const label = labels[index];
    if (label)
      label.labelY = Math.min(
        label.labelY,
        index === labels.length - 1
          ? area.y + area.height - 4
          : (labels[index + 1]?.labelY ?? area.y + area.height) - spacing,
      );
  }
  const x = area.x + area.width;
  return (
    <g aria-hidden="true">
      {labels.map(({ team, value, y, labelY }) => (
        <g key={team.id}>
          <path
            d={`M${x},${y} L${x + 10},${y} L${x + 20},${labelY}`}
            fill="none"
            stroke={teamColor(team.id)}
            strokeOpacity={0.65}
          />
          <text
            x={x + 25}
            y={labelY}
            dominantBaseline="middle"
            fill="var(--foreground)"
            fontSize={11}
            fontWeight={
              team.id === trackedTeamId || team.id === focusedTeamId ? 700 : 500
            }
          >
            {team.abbrev}
            <tspan dx={7} fill="var(--muted-foreground)">
              {metric === "rank" ? `#${value}` : points(value)}
            </tspan>
          </text>
        </g>
      ))}
    </g>
  );
}
function RankedTooltip({
  active,
  payload,
  label,
  metric,
  visible,
  trackedTeamId,
}: Pick<TooltipContentProps, "active" | "payload" | "label"> &
  Pick<Props, "metric" | "visible" | "trackedTeamId">) {
  if (!active || !payload.length) return null;
  const entries = payload
    .flatMap((entry) => {
      const team = visible.find((item) => `team-${item.id}` === entry.dataKey);
      return team && typeof entry.value === "number"
        ? [{ team, value: entry.value }]
        : [];
    })
    .sort(
      (a, b) =>
        (metric === "rank" ? a.value - b.value : b.value - a.value) ||
        a.team.id - b.team.id,
    );
  return (
    <div
      style={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgb(0 0 0 / 10%)",
        fontSize: 12,
        color: "var(--foreground)",
        minWidth: 210,
      }}
    >
      <div style={{ color: "var(--muted-foreground)", marginBottom: 8 }}>
        {new Date(String(label)).toLocaleDateString("en-CA", {
          month: "short",
          day: "numeric",
          timeZone: "America/Montreal",
        })}
      </div>
      {entries.map(({ team, value }, index) => (
        <div
          key={team.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "3px 0",
            fontWeight: team.id === trackedTeamId ? 700 : 400,
          }}
        >
          <span
            style={{
              color: "var(--muted-foreground)",
              width: 16,
              fontSize: 10,
            }}
          >
            {index + 1}
          </span>
          <span
            style={{
              background: teamColor(team.id),
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>
            {team.abbrev}
            {team.id === trackedTeamId ? " · You" : ""}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {metric === "rank" ? `#${value}` : points(value)}
          </span>
        </div>
      ))}
    </div>
  );
}
export default function ProgressChart({
  rows,
  metric,
  resolution,
  visible,
  teamCount,
  focusedTeamId = null,
  trackedTeamId = null,
  onFocusTeam,
}: Props) {
  if (rows.length === 1 && metric !== "change") {
    const snapshot = visible
      .flatMap((team) => {
        const value = rows[0]?.[`team-${team.id}`];
        return typeof value === "number" ? [{ ...team, value }] : [];
      })
      .sort((a, b) =>
        metric === "rank" ? a.value - b.value : b.value - a.value,
      );
    return (
      <ResponsiveContainer className="chart-frame" width="100%" height="100%">
        <BarChart
          data={snapshot}
          layout="vertical"
          margin={{ top: 8, right: 28, left: 8, bottom: 8 }}
          accessibilityLayer
        >
          <CartesianGrid
            stroke="var(--chart-grid)"
            horizontal={false}
            strokeDasharray="3 5"
          />
          <XAxis
            type="number"
            allowDecimals={metric !== "rank"}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="abbrev"
            width={46}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--surface)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            labelFormatter={(_label, payload) =>
              payload[0]?.payload.name ?? "Team"
            }
            formatter={(value) => [
              metric === "rank" ? `#${value}` : points(Number(value)),
              metric === "gap"
                ? "Differential"
                : metric === "rank"
                  ? "Rank"
                  : metric === "rate" || metric === "form"
                    ? "Points per game"
                    : "Points",
            ]}
          />
          <Bar
            dataKey="value"
            barSize={12}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            {snapshot.map((team) => (
              <Cell
                key={team.id}
                fill={teamColor(team.id)}
                fillOpacity={team.id === trackedTeamId ? 1 : 0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer className="chart-frame" width="100%" height="100%">
      <LineChart
        data={rows}
        margin={{ top: 20, right: 116, left: 0, bottom: 12 }}
        accessibilityLayer
      >
        <CartesianGrid
          stroke="var(--chart-grid)"
          strokeDasharray="3 5"
          vertical={false}
        />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(value) =>
            resolution === "captures"
              ? new Date(String(value)).toLocaleString("en-CA", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Montreal",
                })
              : shortDate(String(value))
          }
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={55}
        />
        <YAxis
          reversed={metric === "rank"}
          allowDecimals={metric !== "rank"}
          domain={metric === "rank" ? [1, teamCount] : ["auto", "auto"]}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          content={(props) => (
            <RankedTooltip
              {...props}
              metric={metric}
              visible={visible}
              trackedTeamId={trackedTeamId}
            />
          )}
          wrapperStyle={{ zIndex: 10 }}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
        />
        {metric === "gap" || metric === "change" ? (
          <ReferenceLine
            y={0}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
          />
        ) : null}
        {visible.map((team) => (
          <Line
            key={team.id}
            type="linear"
            dataKey={`team-${team.id}`}
            name={`${team.name} (${team.abbrev})`}
            stroke={teamColor(team.id)}
            strokeWidth={
              team.id === trackedTeamId || team.id === focusedTeamId ? 3 : 1.5
            }
            strokeOpacity={
              team.id === trackedTeamId || team.id === focusedTeamId ? 1 : 0.5
            }
            onClick={() => onFocusTeam?.(team.id)}
            dot={
              rows.length <= 5 &&
              (team.id === trackedTeamId || team.id === focusedTeamId)
                ? { r: 4, strokeWidth: 2, fill: "var(--card)" }
                : false
            }
            activeDot={{
              r:
                team.id === trackedTeamId || team.id === focusedTeamId ? 5 : 3,
            }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
        <Customized
          component={
            <EndpointLabels
              rows={rows}
              visible={visible}
              metric={metric}
              focusedTeamId={focusedTeamId}
              trackedTeamId={trackedTeamId}
            />
          }
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
