import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mainFlows } from "./flows";

// Walkthrough of the running demo with visual effects ON (glass, 3D, motion) on the local FISCO BCOS
// network: the main flows, frame-rate samples, screenshots of every page in both modes, and a short
// video. Opt-in, because it moves demo units on the demo chain and opens a visible Chrome window
// (headless Chrome renders WebGL in software, which would not show real frame rates):
//   E2E_GLASS_URL=http://localhost:3000 pnpm --filter web exec playwright test glass-walkthrough
const CONSOLE = process.env.E2E_GLASS_URL;
const directory = resolve(process.cwd(), "../docs/screenshots/glass");

test.use({
  ...(CONSOLE ? { baseURL: CONSOLE } : {}),
  channel: "chrome", headless: false, reducedMotion: "no-preference", viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"] },
});
test.describe.configure({ mode: "serial", timeout: 600_000 });

async function effectsOn(page: Page) {
  await expect(page.locator("html")).toHaveClass(/effects-on/);
}

async function shot(page: Page, name: string) {
  mkdirSync(directory, { recursive: true });
  const hidden = await page.addStyleTag({ content: "[data-testid=toast] { display: none !important; }" });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(900);
  if (!await page.locator("html").evaluate((element) => element.classList.contains("dark"))) await page.getByLabel("Toggle color mode").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(directory, `${name}-dark.png`) });
  await page.getByLabel("Toggle color mode").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(directory, `${name}-light.png`) });
  await page.getByLabel("Toggle color mode").click();
  await hidden.evaluate((element) => element.remove());
}

/** Frames per second over `ms`, from requestAnimationFrame, plus the 95th-percentile frame time. */
async function fps(page: Page, ms = 5_000) {
  return page.evaluate((duration) => new Promise<{ fps: number; p95FrameMs: number; frames: number }>((done) => {
    const times: number[] = [];
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      times.push(now - last); last = now;
      if (now - start < duration) requestAnimationFrame(tick);
      else {
        const sorted = times.slice(1).sort((a, b) => a - b);
        done({ fps: Math.round((times.length - 1) / ((now - start) / 1000) * 10) / 10, p95FrameMs: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10, frames: times.length - 1 });
      }
    };
    requestAnimationFrame(tick);
  }), ms);
}

test("runs the main flows with effects on and captures every page", async ({ page }) => {
  test.skip(!CONSOLE, "Set E2E_GLASS_URL to the running console, e.g. http://localhost:3000");
  await page.addInitScript(() => { if (!sessionStorage.getItem("tour-cleared")) { localStorage.setItem("guardian-tour-done", "1"); localStorage.removeItem("guardian-reduce-effects"); sessionStorage.setItem("tour-cleared", "1"); } });
  await page.goto("/#/");
  await effectsOn(page);
  await mainFlows(page, shot);
});

test("measures frame rate on Home, Activity, and Attack Lab", async ({ browser }) => {
  test.skip(!CONSOLE, "Set E2E_GLASS_URL to the running console");
  // MacBook Air-like viewport: 1440×900 at device pixel ratio 2 (the 3D canvases cap at 1.5).
  const context = await browser.newContext({ baseURL: CONSOLE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await context.newPage();
  const results: Record<string, unknown> = {};
  await page.addInitScript(() => localStorage.setItem("guardian-tour-done", "1"));
  for (const [route, name] of [["/", "home"], ["/activity", "activity"], ["/security/attack-lab", "attack-lab"]] as const) {
    await page.goto(`/#${route}`);
    await effectsOn(page);
    await expect(page.getByTestId("page-title")).toBeAttached();
    await page.waitForTimeout(2_000);
    results[name] = await fps(page);
  }
  await context.close();
  const output = { measuredAt: new Date().toISOString(), viewport: "1440x900 @2x", browser: `Chrome ${browser.version()}`, effects: "on", results };
  writeFileSync(resolve(directory, "fps.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
});

test("records a short video: Home, a payment, Activity, and Attack Lab", async ({ browser }) => {
  test.skip(!CONSOLE, "Set E2E_GLASS_URL to the running console");
  await record(browser);
});

async function record(browser: Browser) {
  const size = { width: 1280, height: 800 };
  const context = await browser.newContext({ baseURL: CONSOLE!, viewport: size, recordVideo: { dir: resolve(directory, "video-tmp"), size }, reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("guardian-tour-done", "1"));
  await page.goto("/#/");
  await effectsOn(page);
  await expect(page.getByTestId("balance-card").first()).toBeVisible({ timeout: 30_000 });
  for (const [x, y] of [[900, 300], [1100, 220], [800, 420]] as const) { await page.mouse.move(x, y, { steps: 20 }); await page.waitForTimeout(600); }
  await page.getByLabel("What should your AI do?").pressSequentially("Send Ana $600", { delay: 90 });
  await page.getByLabel("What should your AI do?").press("Enter");
  await expect(page.getByTestId("chat-summary")).toContainText("Blocked", { timeout: 60_000 });
  await page.waitForTimeout(1_600);
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Activity" }).click();
  await page.waitForTimeout(1_200);
  await nav.getByRole("link", { name: "Security" }).click();
  await page.waitForTimeout(800);
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall", { timeout: 60_000 });
  await page.getByTestId("attack-A1").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_800);
  const video = page.video()!;
  await context.close();
  renameSync(await video.path(), resolve(directory, "demo.webm"));
}
