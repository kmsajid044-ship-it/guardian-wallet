import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Walkthrough of the running demo with visual effects ON (glass, 3D, motion) on the local FISCO BCOS
// network: the main flows, frame-rate samples, screenshots of every page in both modes, and a short
// video. Opt-in, because it moves demo units on the demo chain and opens a visible Chrome window
// (headless Chrome renders WebGL in software, which would not show real frame rates):
//   E2E_GLASS_URL=http://localhost:3000 pnpm --filter web exec playwright test glass-walkthrough
const CONSOLE = process.env.E2E_GLASS_URL;
const directory = resolve(process.cwd(), "../docs/screenshots/glass");
const pages = [["/", "home"], ["/agent", "ai-agent"], ["/wallet", "wallet"], ["/control", "control-center"], ["/attack-lab", "attack-lab"], ["/evidence", "evidence-inspector"], ["/evaluation", "evaluation"]] as const;

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

async function ask(page: Page, example: string) {
  await page.getByRole("button", { name: example, exact: true }).click();
  await expect(page.getByTestId("chat-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 60_000 });
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
  await page.goto("/#/agent");
  await page.evaluate(() => localStorage.removeItem("guardian-reduce-effects"));
  await page.reload();
  await effectsOn(page);
  await expect(page.getByTestId("chain-badge")).toHaveText(/^FISCO BCOS · 1337 · #\d+$/, { timeout: 30_000 });

  // 1. Pay 50 USD, then verify its receipt.
  await ask(page, "Pay Ana 50 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Done. Paid 50 USD to Ana.");
  await page.getByText("Details: why, checks, and proof").click();
  await page.getByTestId("proof-verify").click();
  await expect(page.getByTestId("proof-receipt")).toContainText("Receipt success · block", { timeout: 30_000 });

  // 2. The two-step plan.
  await ask(page, "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD");
  await expect(page.getByTestId("chat-summary")).toContainText("Plan ready: 2 steps, 2 checked");
  await page.getByTestId("plan-run").click();
  await expect(page.getByTestId("chat-summary")).toHaveText("Done. All 2 steps ran.", { timeout: 60_000 });
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-state")).toHaveText("Done");
  await page.getByTestId("plan-step-S1").getByTestId("step-verify").click();
  await expect(page.getByTestId("plan-step-S1").getByTestId("step-receipt")).toContainText("Receipt success", { timeout: 30_000 });
  await shot(page, "ai-agent");

  // 3. A 600 USD payment is blocked.
  await ask(page, "Send Ana 600 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Blocked: above your 500 USD per-payment limit.");
  await shot(page, "ai-agent-blocked");

  // 4. 250 USD waits for approval; approve it. The card collapses and a toast confirms the chain receipt.
  await ask(page, "Pay Ana 250 USD");
  await expect(page.getByTestId("chat-summary")).toHaveText("Waiting for your approval because it is above your 200 USD approval limit.");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Control Center" }).click();
  const card = page.locator("[data-testid^='pending-']").filter({ has: page.getByTestId("pending-why") }).first();
  await expect(card.getByTestId("pending-why")).toHaveText("It is above your 200 USD approval limit.");
  await shot(page, "control-center");
  const id = (await card.getAttribute("data-testid"))!.replace("pending-", "");
  await card.getByTestId(`approve-${id}`).click();
  await expect(page.getByTestId("toast")).toContainText("Approved and paid.", { timeout: 60_000 });
  await expect(page.getByTestId(`confirmed-${id}`)).toContainText("approved and paid · confirmed on chain");
  await expect(page.getByTestId(`pending-${id}`)).toHaveCount(0);

  // 5. Pause and resume; the banner slides down and away.
  await page.getByTestId("kill-switch").click();
  await page.getByRole("dialog", { name: "Pause all AI payments?" }).getByRole("button", { name: "Pause everything" }).click();
  await expect(page.getByTestId("paused-banner")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(directory, "paused-dark.png") });
  await page.getByTestId("banner-resume").click();
  await expect(page.getByTestId("paused-banner")).toHaveCount(0, { timeout: 60_000 });

  // 6. Wallet: the card stack fans out, and the send flow opens as a bottom sheet.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Wallet" }).click();
  await expect(page.getByTestId("balance-card").first()).toBeVisible();
  await page.getByTestId("card-stack").click();
  await shot(page, "wallet");
  await page.getByTestId("open-send-sheet").click();
  await expect(page.getByTestId("send-sheet")).toBeVisible();
  await page.getByLabel("Payment amount").pressSequentially("5", { delay: 120 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(directory, "wallet-send-sheet-dark.png") });
  await page.getByRole("button", { name: "Ask AI to pay" }).click();
  await expect(page.getByLabel("Message the agent")).toHaveValue("Pay Ana 5 USD");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("chat-summary")).toBeVisible({ timeout: 60_000 });

  // 7. One attack; the cube pulses when it is blocked.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Attack Lab" }).click();
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall", { timeout: 120_000 });
  await shot(page, "attack-lab");

  // 8. Verify one exported hash against the node.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Evidence Inspector" }).click();
  await page.getByRole("tab", { name: /Refused on-chain/ }).click();
  const refusal = page.getByTestId("group-refusals").locator("[data-testid^='tx-0x']").first();
  await refusal.getByTestId("tx-verify").click();
  await expect(refusal.getByTestId("tx-verify-result")).toContainText("Match", { timeout: 30_000 });
  await shot(page, "evidence-inspector");

  for (const [route, name] of pages.filter(([, name]) => ["home", "evaluation"].includes(name))) {
    await page.goto(`/#${route}`);
    await expect(page.getByTestId("page-title")).toBeVisible();
    await shot(page, name);
  }
});

test("measures frame rate on Home, Wallet, and Attack Lab", async ({ browser }) => {
  test.skip(!CONSOLE, "Set E2E_GLASS_URL to the running console");
  // MacBook Air-like viewport: 1440×900 at device pixel ratio 2 (the 3D canvases cap at 1.5).
  const context = await browser.newContext({ baseURL: CONSOLE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await context.newPage();
  const results: Record<string, unknown> = {};
  for (const [route, name] of [["/", "home"], ["/wallet", "wallet"], ["/attack-lab", "attack-lab"]] as const) {
    await page.goto(`/#${route}`);
    await effectsOn(page);
    await expect(page.getByTestId("page-title")).toBeVisible();
    await page.waitForTimeout(2_000);
    if (name === "wallet") await page.getByTestId("card-stack").hover();
    results[name] = await fps(page);
  }
  await context.close();
  const output = { measuredAt: new Date().toISOString(), viewport: "1440x900 @2x", browser: `Chrome ${browser.version()}`, effects: "on", results };
  writeFileSync(resolve(directory, "fps.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
});

test("records a short video: Home, the Wallet send sheet, and Attack Lab", async ({ browser }) => {
  test.skip(!CONSOLE, "Set E2E_GLASS_URL to the running console");
  await record(browser);
});

async function record(browser: Browser) {
  const size = { width: 1280, height: 800 };
  const context = await browser.newContext({ baseURL: CONSOLE!, viewport: size, recordVideo: { dir: resolve(directory, "video-tmp"), size }, reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/#/");
  await effectsOn(page);
  await expect(page.getByTestId("home-balance").first()).toBeVisible({ timeout: 30_000 });
  for (const [x, y] of [[900, 300], [1100, 220], [800, 420], [1000, 330]] as const) { await page.mouse.move(x, y, { steps: 20 }); await page.waitForTimeout(700); }
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Wallet" }).click();
  await expect(page.getByTestId("card-stack")).toBeVisible();
  await page.waitForTimeout(900);
  await page.getByTestId("card-stack").hover();
  await page.waitForTimeout(1_400);
  await page.mouse.move(640, 760, { steps: 10 });
  await page.waitForTimeout(600);
  await page.getByTestId("open-send-sheet").click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Bob$/ }).click();
  await page.getByLabel("Payment amount").pressSequentially("12500", { delay: 220 });
  await page.waitForTimeout(900);
  await page.getByLabel("Close").click();
  await page.waitForTimeout(600);
  await nav.getByRole("link", { name: "Attack Lab" }).click();
  await page.waitForTimeout(1_000);
  await page.getByTestId("run-A1").click();
  await expect(page.getByTestId("attack-A1")).toContainText("Stopped by the AI firewall", { timeout: 60_000 });
  await page.getByTestId("attack-A1").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_800);
  const video = page.video()!;
  await context.close();
  renameSync(await video.path(), resolve(directory, "demo.webm"));
}
