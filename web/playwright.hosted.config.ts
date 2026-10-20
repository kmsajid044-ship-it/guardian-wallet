import { defineConfig } from "@playwright/test";

// Hosted online demo only: runs tests-hosted/ against an already running container at HOSTED_URL.
// No local dev server is started.
export default defineConfig({
  testDir: "./tests-hosted",
  timeout: 180_000,
  workers: 1,
  use: { baseURL: process.env.HOSTED_URL ?? "http://127.0.0.1:7860", viewport: { width: 1440, height: 1000 }, colorScheme: "light", locale: "en-US", reducedMotion: "reduce" },
});
