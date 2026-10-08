import { test, expect } from "@playwright/test";
import type { Dashboard } from "../src/lib/schema.ts";
const fixture: Dashboard = {
  leagueId: 918256829,
  season: 2027,
  trackedTeamId: 3,
  intervalMinutes: 15,
  gamesCap: 1313,
  live: null,
  liveError: null,
  teams: [
    { id: 3, name: "Astra", abbrev: "AST" },
    { id: 10, name: "Félix", abbrev: "FFT" },
    { id: 14, name: "Frank", abbrev: "FFT" },
  ],
  observations: [
    {
      timestamp: "2026-10-01T20:00:00Z",
      period: 1,
      points: { 3: 10, 10: 15, 14: 12 },
      games: { 3: 5, 10: 10, 14: 6 },
    },
    {
      timestamp: "2026-10-02T20:00:00Z",
      period: 2,
      points: { 3: 20, 10: 18, 14: 18 },
      games: { 3: 8, 10: 12, 14: 12 },
    },
  ],
  // Scoring days and role totals add up to the captured totals above.
  roles: {
    through: 2,
    caps: { "3": 689, "4": 383, "5": 164, "6": 77 },
    sd: { "3": 1.5, "4": 1, "5": 2, "6": 1 },
    teams: {
      "3": {
        "3": { points: 16, games: 5 },
        "4": { points: 4, games: 3 },
        "5": { points: 0, games: 0 },
        "7": { points: 3.5, games: 2 },
      },
      "10": {
        "3": { points: 12, games: 8 },
        "4": { points: 0, games: 2 },
        "5": { points: 6, games: 2 },
      },
      "14": {
        "3": { points: 10, games: 4 },
        "4": { points: 6, games: 6 },
        "6": { points: 2, games: 2 },
      },
    },
    days: [
      {
        period: 1,
        points: { 3: 10, 10: 15, 14: 12 },
        games: { 3: 5, 10: 10, 14: 6 },
        bench: { 3: 3.5 },
      },
      {
        period: 2,
        points: { 3: 10, 10: 3, 14: 6 },
        games: { 3: 3, 10: 2, 14: 6 },
        bench: {},
      },
    ],
  },
  schedule: {
    start: "2026-10-01",
    finalPeriod: 10,
    nhlGames: Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [index + 1, 10]),
    ),
  },
  rolesError: null,
  lastAttempt: "2026-10-02T20:00:00Z",
  lastSuccess: "2026-10-02T20:00:00Z",
  error: null,
};
test("filters, baseline, dates, chart modes, sorting and persistence work with multi-day history", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Season progress" }),
  ).toBeVisible();
  await expect(page.locator(".league-standings tbody tr")).toHaveCount(3);
  await expect(
    page.locator(".league-standings tbody tr").first(),
  ).toContainText("Astra");
  await page.getByRole("button", { name: "Hide all", exact: true }).click();
  await expect(page.getByText("The ice is yours.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Show Astra", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Show Astra", exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Show Astra", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Show Frank", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "Differential", exact: true }).click();
  await page.getByRole("combobox", { name: "Differential baseline" }).click();
  await page.getByRole("option", { name: "Frank", exact: true }).click();
  await expect(page.locator(".chart-meta")).toContainText("vs. Frank");
  await expect(
    page.locator(".league-standings tbody tr").first(),
  ).toContainText("+2.00");
  await page.getByRole("tab", { name: "Point change", exact: true }).click();
  await expect(
    page.locator(".chart-area .recharts-surface").first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Rank", exact: true }).click();
  await expect(page.locator(".chart-meta")).toContainText("League rank");
  await page.getByRole("button", { name: "TOTAL POINTS" }).click();
  await expect(
    page.locator(".league-standings tbody tr").first(),
  ).toContainText("Astra");
  await page.getByRole("button", { name: "TOTAL POINTS" }).click();
  await expect(
    page.locator(".league-standings tbody tr").first(),
  ).toContainText("Félix");
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Custom dates" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await expect(
    page.getByText("No recorded data for this range. Try the full season."),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Full season" }).click();
  await page.getByRole("textbox", { name: "Search teams" }).fill("Frank");
  await expect(page.locator(".league-standings tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", { name: "Show Frank", exact: true }),
  ).toBeVisible();
});

test("points per game drives the chart, standings, and Astra summary", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  await expect(page.locator(".stats-grid")).toContainText("2.50pts/GP");
  await expect(page.locator(".stats-grid")).toContainText(
    "#1 in the league · 3,284-pt pace",
  );
  const astra = page.locator(".league-standings tbody tr.astra-row");
  await expect(astra.locator("td").nth(3)).toHaveText("8");
  await expect(astra.locator("td").nth(4)).toHaveText("2.50");
  await expect(astra.locator("td").nth(5)).toHaveText("2.50");
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await expect(page.locator(".chart-meta")).toContainText(
    "Points per game, last 7 days",
  );
  await expect(
    page.locator(".team-list .team-option-points").first(),
  ).toHaveText("2.50pts/GP");
  await page.getByRole("tab", { name: "Pts / GP", exact: true }).click();
  await expect(page.locator(".chart-meta")).toContainText("Points per game");
  await expect(
    page.locator(".chart-area .recharts-surface").first(),
  ).toBeVisible();
  await expect(
    page.locator(".team-list .team-option-points").first(),
  ).toHaveText("2.50pts/GP");
  await expect(page.locator(".team-list .team-option-rank")).toHaveText([
    "#1",
    "#2",
    "#2",
  ]);
  await page.getByRole("button", { name: "PTS / GP" }).click();
  await expect(
    page.locator(".league-standings tbody tr").first(),
  ).toContainText("Astra");
  await expect(page.locator(".league-standings tbody tr").last()).toContainText(
    "Frank",
  );
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Custom dates" }).click();
  await page.getByLabel("To", { exact: true }).fill("2026-10-01");
  await expect(page.locator(".league-standings tbody tr").last()).toContainText(
    "Félix",
  );
});
test("role breakdown ranks points per game by lineup slot", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  const panel = page.locator(".roles-panel");
  await expect(panel.locator(".standings-heading > span")).toHaveText(
    "Astra F #1 · D #1 · G — · UTIL —",
  );
  const rows = panel.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Astra");
  await expect(rows.nth(1)).toContainText("Frank");
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText(
    "3.20#1 · 16.00 pts5 GP · 133 behind pace",
  );
  await expect(rows.nth(0).locator("td").nth(5)).toHaveText(
    "3.502 games on bench",
  );
  await panel.getByRole("button", { name: "GOALIES" }).click();
  await expect(rows.nth(0)).toContainText("Félix");
  await expect(rows.nth(0).locator("td").nth(3)).toContainText(
    "3.00#1 · 6.00 pts2 GP",
  );
  await page.getByRole("textbox", { name: "Search teams" }).fill("Frank");
  await expect(rows).toHaveCount(1);
});
test("season outlook simulates odds and the daily chart uses scoring days", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  const panel = page.locator(".outlook-panel");
  await expect(panel.locator("tbody tr")).toHaveCount(3);
  await expect(panel.locator("tbody tr").first()).toContainText("Astra");
  await expect(panel.locator("tbody tr").first()).toContainText("100%");
  await expect(panel.locator(".standings-heading > span")).toContainText(
    "to win · 100% top 3",
  );
  await expect(page.locator(".astra-stat")).toContainText("to win");
  await expect(page.locator(".stats-grid")).toContainText("ASTRA’S LAST DAY");
  await expect(page.locator(".stats-grid")).toContainText("+10.00pts");
  await expect(page.locator(".stats-grid")).toContainText("Oct 2 · 3 GP");
  await page.getByRole("tab", { name: "Point change", exact: true }).click();
  await expect(page.locator(".chart-footer")).toContainText(
    "Points scored on each completed scoring day.",
  );
});
test("points per game waits for ESPN games played", async ({ page }) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      json: {
        ...fixture,
        gamesCap: null,
        roles: { through: null, caps: {}, sd: {}, teams: {}, days: [] },
        schedule: null,
        rolesError: "Role breakdown does not match ESPN team totals.",
        observations: fixture.observations.map((row) => ({
          ...row,
          games: {},
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".stats-grid")).toContainText(
    "Available once ESPN reports games played",
  );
  await page.getByRole("tab", { name: "Pts / GP", exact: true }).click();
  await expect(page.getByText("Waiting for games played.")).toBeVisible();
  await expect(page.locator(".roles-panel")).toContainText(
    "Available after ESPN completes the first scoring day.",
  );
  await expect(page.locator(".roles-alert")).toContainText("does not match");
});
test("a single snapshot compares teams without inventing progression", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      json: {
        ...fixture,
        observations: fixture.observations.slice(-1),
        roles: { ...fixture.roles, days: [] },
        schedule: null,
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.locator(".single-snapshot .recharts-bar-rectangle"),
  ).toHaveCount(3);
  await expect(page.locator(".chart-footer")).toContainText(
    "First snapshot saved",
  );
  await page
    .getByRole("button", { name: "Focus on Astra", exact: true })
    .click();
  await expect(
    page.locator(".single-snapshot .recharts-bar-rectangle"),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "Point change", exact: true }).click();
  await expect(page.getByText("A little more history to go.")).toBeVisible();
});
test("league order follows the selected endpoint and highlighting preserves team visibility", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.goto("/");
  const names = page.locator(".team-list .team-option-name");
  await expect(names).toHaveText(["AstraYOU", "Félix", "Frank"]);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Custom dates" }).click();
  await page.getByLabel("To", { exact: true }).fill("2026-10-01");
  await expect(names).toHaveText(["Félix", "Frank", "AstraYOU"]);
  await page.getByRole("tab", { name: "Rank", exact: true }).click();
  await expect(names).toHaveText(["Félix", "Frank", "AstraYOU"]);
  await page.getByRole("checkbox", { name: "Show Frank", exact: true }).click();
  await page
    .getByRole("button", { name: "Highlight Frank in chart", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Show Frank", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "Stop highlighting Frank in chart",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("real league renders on desktop and phone without browser errors or page overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".league-standings tbody tr")).toHaveCount(14);
  await expect(page.locator(".connection")).toContainText(
    /ESPN connected|Live scores · provisional/,
  );
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Sync ESPN" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("theme follows system preference, supports keyboard toggling, and persists across reloads", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Switch to dark theme" }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to light theme" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator(".league-standings tbody tr")).toHaveCount(14);
});

test("both themes render desktop and mobile controls, charts, and overlays", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(
    page.locator(".chart-area .recharts-surface").first(),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("combobox", { name: "Date range" }).click();
    await expect(
      page.getByRole("option", { name: "Full season" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
    await expect(
      page.locator(".chart-area .recharts-surface").first(),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/theme-${theme}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", {
        name: `Switch to ${theme === "light" ? "dark" : "light"} theme`,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/theme-${theme}-mobile.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("Daily standings show changing live totals while form keeps completed days", async ({
  page,
}) => {
  let live = {
    timestamp: "2026-10-04T02:00:00.000Z",
    period: 3,
    points: { "3": 36.75, "10": 18, "14": 18 },
    games: { "3": 9, "10": 12, "14": 12 },
  };
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      json: {
        ...fixture,
        live,
        observations: [...fixture.observations, live],
      },
    }),
  );
  await page.goto("/");
  const astra = page.locator(".league-standings tbody tr.astra-row");
  await expect(astra.locator("td").nth(2)).toHaveText("36.75");
  await expect(astra.locator("td").nth(3)).toHaveText("9");
  await expect(page.locator(".connection")).toContainText("provisional");
  live = { ...live, points: { ...live.points, "3": 40 } };
  await page.reload();
  await expect(astra.locator("td").nth(2)).toHaveText("40.00");
  await page.getByRole("tab", { name: "Form", exact: true }).click();
  await expect(astra.locator("td").nth(2)).toHaveText("20.00");
});

test("tracked team default follows TRACKED_TEAM_ID from the dashboard", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: { ...fixture, trackedTeamId: 14 } }),
  );
  await page.goto("/");
  await expect(page.locator(".astra-stat .stat-number")).toContainText("#1");
  await expect(page.locator(".stats-grid")).toContainText("FRANK’S LAST DAY");
  await expect(
    page.getByRole("button", { name: "Focus on Frank", exact: true }),
  ).toBeVisible();
});
