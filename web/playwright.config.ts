import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // Live specs each deploy contracts with forge into the shared contracts/ build; run files one at a time.
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", viewport: { width: 1440, height: 1000 }, colorScheme: "light" },
  webServer: { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true },
});
