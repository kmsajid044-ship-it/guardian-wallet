import { test } from "@playwright/test";
import { mainFlows } from "./flows";

// The main owner flows on the running demo (./scripts/demo.sh) on the local FISCO BCOS network,
// headless with effects reduced. Opt-in, because it moves demo units on the demo chain:
//   E2E_CONSOLE_URL=http://localhost:3000 pnpm --filter web exec playwright test console-pages
const CONSOLE = process.env.E2E_CONSOLE_URL;

test.use({ viewport: { width: 1440, height: 900 }, ...(CONSOLE ? { baseURL: CONSOLE } : {}) });
test.describe.configure({ mode: "serial", timeout: 300_000 });

test("runs the main flows on FISCO BCOS", async ({ page }) => {
  test.skip(!CONSOLE, "Set E2E_CONSOLE_URL to the running console, e.g. http://localhost:3000");
  await page.addInitScript(() => { if (!sessionStorage.getItem("tour-cleared")) { localStorage.setItem("guardian-tour-done", "1"); sessionStorage.setItem("tour-cleared", "1"); } });
  await mainFlows(page, async () => undefined);
});
