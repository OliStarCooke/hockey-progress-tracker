import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.TRACKER_TEST_URL ?? "http://127.0.0.1:3210",
    headless: true,
  },
  workers: 1,
});
