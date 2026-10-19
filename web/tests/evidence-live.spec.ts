import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startLiveAgent, useLiveAgent, type LiveAgent } from "./live-agent";

// The real agent API serving the committed evidence/evidence.json; Verify asks the FISCO BCOS node
// that produced it. Nothing is mocked. Requires the local network from ./scripts/chain-up.sh.
type Evidence = {
  network: { chainId: number; rpcUrl: string };
  transactions: Array<{ hash: string; status: string; blockNumber: number; events: Array<{ name: string }> }>;
  decisions?: Array<{ offChain: boolean }>;
};
const evidence = JSON.parse(readFileSync(resolve(process.cwd(), "../evidence/evidence.json"), "utf8")) as Evidence;
const isRefusal = (tx: Evidence["transactions"][number]) => tx.status === "reverted" || tx.events.some((event) => event.name === "PolicyViolation");
const TX_HASH = /0x[0-9a-fA-F]{64}/;

let agent: LiveAgent;
test.describe.configure({ mode: "serial", timeout: 120_000 });
test.beforeAll(async () => { agent = await startLiveAgent(); });
test.afterAll(async () => { await agent?.stop(); });

test("inspects the exported FISCO BCOS evidence and verifies receipts against the node", async ({ page, request }) => {
  const node = await request.post(evidence.network.rpcUrl, { data: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, failOnStatusCode: false }).catch(() => undefined);
  const nodeChain = node?.ok() ? Number((await node.json() as { result: string }).result) : undefined;
  test.skip(nodeChain !== evidence.network.chainId, `FISCO BCOS node at ${evidence.network.rpcUrl} is not running; start it with ./scripts/chain-up.sh`);

  await useLiveAgent(page, agent);
  await page.goto("/#/evidence");
  await expect(page.getByTestId("evidence-network")).toContainText(`chain ID ${evidence.network.chainId}`);
  const refusals = evidence.transactions.filter(isRefusal);
  const offChain = (evidence.decisions ?? []).filter((item) => item.offChain).length;
  await expect(page.getByTestId("total-executed")).toHaveText(String(evidence.transactions.length - refusals.length));
  await expect(page.getByTestId("total-refusals")).toHaveText(String(refusals.length));
  await expect(page.getByTestId("total-offchain")).toHaveText(String(offChain));
  expect(offChain).toBeGreaterThan(0);

  // Off-chain blocks carry an audit record and never a transaction hash.
  const offChainGroup = page.getByTestId("group-offchain");
  expect(await offChainGroup.innerText()).not.toMatch(TX_HASH);
  await expect(offChainGroup.getByTestId("audit-chain").first()).toHaveText("Verifies");

  // Every on-chain refusal shows its hash; the first one and the first executed one match the node.
  const refusalGroup = page.getByTestId("group-refusals");
  await expect(refusalGroup.locator("[data-testid^='tx-0x']")).toHaveCount(refusals.length);
  const refusal = refusals[0]!;
  const refusalCard = refusalGroup.getByTestId(`tx-${refusal.hash}`);
  await refusalCard.getByTestId("tx-verify").click();
  await expect(refusalCard.getByTestId("tx-verify-result")).toHaveText(`Match · receipt in block ${refusal.blockNumber} on chain ${evidence.network.chainId}, equal to the export`, { timeout: 30_000 });
  const paid = page.getByTestId("group-executed").getByTestId("scenario-E02");
  await paid.locator("summary").click();
  const executedCard = paid.locator("[data-testid^='tx-0x']").first();
  await executedCard.getByTestId("tx-verify").click();
  await expect(executedCard.getByTestId("tx-verify-result")).toHaveText(/^Match · receipt in block \d+ on chain \d+, equal to the export$/, { timeout: 30_000 });

  const directory = resolve(process.cwd(), "../docs/screenshots");
  mkdirSync(directory, { recursive: true });
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.screenshot({ path: resolve(directory, "evidence-inspector.png"), fullPage: true });
});
