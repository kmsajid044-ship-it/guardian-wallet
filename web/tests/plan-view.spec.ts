import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";

// End to end against the real agent API on a fresh local Anvil chain: nothing here is mocked.
// The page keeps its usual agent URL; the browser's requests are redirected to the live server.
const TARGET = "Pay Ana 50 USD, then move 200 CNY to savings, and ask me before anything above 300 USD.";
const CNY_DISCLAIMER = "Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.";
const PAGE_API = "http://127.0.0.1:8787";

let server: ChildProcess | undefined;
let apiUrl = "";
let rpcUrl = "";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  const agentDirectory = resolve(process.cwd(), "../agent");
  const foundry = resolve(process.env.HOME ?? "", ".foundry/bin");
  server = spawn("pnpm", ["exec", "tsx", "src/exec/e2eServer.ts"], { cwd: agentDirectory, env: { ...process.env, PATH: `${foundry}:${process.env.PATH ?? ""}` }, stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: server.stdout! });
  const ready = await new Promise<{ apiUrl: string; rpcUrl: string }>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("live agent did not start")), 90_000);
    server!.once("exit", (code) => reject(new Error(`live agent exited with ${code}`)));
    lines.on("line", (line) => {
      if (!line.startsWith("{")) return;
      clearTimeout(timer);
      resolveReady(JSON.parse(line) as { apiUrl: string; rpcUrl: string });
    });
  });
  ({ apiUrl, rpcUrl } = ready);
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolveExit) => server!.once("exit", resolveExit));
  server.kill("SIGTERM");
  await exited;
});

test("runs the pay, save, and approval-cap request as a plan with real receipts", async ({ page, request }) => {
  await page.route(`${PAGE_API}/**`, (route) => route.continue({ url: route.request().url().replace(PAGE_API, apiUrl) }));
  await page.goto("/");
  await page.getByLabel("Message the agent").fill(TARGET);
  await page.getByRole("button", { name: "Send" }).click();

  const plan = page.getByTestId("plan-view");
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByTestId("plan-status")).toHaveText("DRAFT");
  await expect(plan.getByTestId("plan-cap")).toHaveText("Ask the owner before anything above 300 USD");
  const first = page.getByTestId("plan-step-S1");
  const second = page.getByTestId("plan-step-S2");
  for (const [step, operation, recipient, amount, currency] of [[first, "pay", "ana", "50", "USD"], [second, "saveToSavings", "Own savings", "200", "CNY"]] as const) {
    await expect(step.getByTestId("step-state")).toHaveText("VALIDATED");
    await expect(step.getByTestId("step-operation")).toHaveText(operation);
    await expect(step.getByTestId("step-recipient")).toHaveText(recipient);
    await expect(step.getByTestId("step-amount")).toHaveText(amount);
    await expect(step.getByTestId("step-currency")).toHaveText(currency);
    await expect(step.getByTestId("step-tier")).toHaveText("T1");
    await expect(step.getByTestId("step-risk")).toHaveText(/^\d+\/100$/);
    // Validation signs nothing, so no transaction is shown yet.
    await expect(step.getByTestId("step-tx")).toHaveCount(0);
  }
  await expect(plan.getByTestId("currency-disclaimer")).toHaveText(CNY_DISCLAIMER);

  await page.getByTestId("plan-run").click();
  await expect(plan.getByTestId("plan-status")).toHaveText("COMPLETED", { timeout: 60_000 });
  for (const step of [first, second]) {
    await expect(step.getByTestId("step-state")).toHaveText("EXECUTED");
    await expect(step.getByTestId("step-block")).toHaveText(/^\d+$/);
    // The hash on screen is a real transaction: the node returns its receipt in the same block.
    const hash = await step.getByTestId("step-tx").getAttribute("title");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const node = await request.post(rpcUrl, { data: { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] } });
    const receipt = (await node.json() as { result: { status: string; blockNumber: string } | null }).result;
    expect(receipt?.status).toBe("0x1");
    const block = await step.getByTestId("step-block").textContent();
    expect(BigInt(receipt!.blockNumber).toString()).toBe(block);
    await step.getByTestId("step-verify").click();
    await expect(step.getByTestId("step-receipt")).toHaveText(`Receipt success · block ${block}`);
  }

  const directory = resolve(process.cwd(), "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  // The sticky header would cover the top of the card in an element capture.
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.locator("section.card", { has: plan }).screenshot({ path: resolve(directory, "plan-view.png") });
});
