import { test } from "node:test";
import assert from "node:assert/strict";
import { syncDelay } from "./schedule.ts";

test("daily collection survives restarts and follows the latest attempt, including failures/manual syncs", () => {
  const now = Date.parse("2026-10-02T12:00:00.000Z");
  assert.equal(syncDelay(null, 1440, now), 0);
  assert.equal(syncDelay("invalid", 1440, now), 0);
  assert.equal(
    syncDelay("2026-10-02T11:00:00.000Z", 1440, now),
    23 * 60 * 60_000,
  );
  assert.equal(syncDelay("2026-10-01T11:00:00.000Z", 1440, now), 0);
  assert.equal(syncDelay("2026-10-02T11:50:00.000Z", 15, now), 5 * 60_000);
});
