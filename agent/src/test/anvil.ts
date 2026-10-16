import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Account,
  type Chain,
  type PublicClient,
  type TestClient,
  type Transport,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
const DeploymentSchema = z.object({
  guardianWallet: AddressSchema,
  demoLedger: AddressSchema,
  owner: AddressSchema,
  agent: AddressSchema,
  feeAccount: AddressSchema,
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate test port");
  const { port } = address;
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  return port;
}

export type AnvilFixture = {
  rpcUrl: string;
  chain: Chain;
  publicClient: PublicClient<Transport, Chain>;
  testClient: TestClient<"anvil", Transport, Chain>;
  agentClient: WalletClient<Transport, Chain, Account>;
  ownerClient: WalletClient<Transport, Chain, Account>;
  wallet: Address;
  ledger: Address;
  owner: Address;
  agent: Address;
  agentKey: `0x${string}`;
  activeRecipient: Address;
  service: Address;
  stop(): Promise<void>;
};

export async function startAnvilFixture(): Promise<AnvilFixture> {
  const port = await availablePort();
  const network = `integration-${port}`;
  const deploymentPath = resolve(root, `deployments/${network}.json`);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: 31337,
    name: "Anvil integration",
    nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const processHandle: ChildProcess = spawn("anvil", ["--silent", "--auto-impersonate", "--port", String(port)], {
    stdio: "ignore",
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 10 });
  const testClient = createTestClient({ mode: "anvil", chain, transport: http(rpcUrl) });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (attempt === 79) throw new Error("Anvil did not start");
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }

  const ownerKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey).address;
  const agentKey = generatePrivateKey();
  const agent = privateKeyToAccount(agentKey).address;
  const activeRecipient = privateKeyToAccount(generatePrivateKey()).address;
  const secondRecipient = privateKeyToAccount(generatePrivateKey()).address;
  const thirdRecipient = privateKeyToAccount(generatePrivateKey()).address;
  const service = privateKeyToAccount(generatePrivateKey()).address;
  await testClient.setBalance({ address: owner, value: 100n * 10n ** 18n });

  execFileSync("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpcUrl, "--broadcast"], {
    cwd: resolve(root, "contracts"),
    env: {
      ...process.env,
      DEPLOYMENTS_FILE: deploymentPath,
      OWNER_PRIVATE_KEY: ownerKey,
      AGENT_ADDRESS: agent,
      GUARDIAN_ADDRESS: "0x0000000000000000000000000000000000000000",
      FEE_ACCOUNT_ADDRESS: service,
      DEMO_CONTACT_1_ADDRESS: activeRecipient,
      DEMO_CONTACT_2_ADDRESS: secondRecipient,
      DEMO_CONTACT_3_ADDRESS: thirdRecipient,
    },
    stdio: "ignore",
  });

  const deployment = DeploymentSchema.parse(JSON.parse(readFileSync(deploymentPath, "utf8")));
  await testClient.impersonateAccount({ address: agent });
  await testClient.impersonateAccount({ address: owner });
  await testClient.setBalance({ address: agent, value: 100n * 10n ** 18n });
  await testClient.increaseTime({ seconds: 601 });
  await testClient.mine({ blocks: 1 });

  return {
    rpcUrl,
    chain,
    publicClient,
    testClient,
    agentClient: createWalletClient({ account: agent, chain, transport: http(rpcUrl), pollingInterval: 10 }),
    ownerClient: createWalletClient({ account: owner, chain, transport: http(rpcUrl), pollingInterval: 10 }),
    wallet: deployment.guardianWallet,
    ledger: deployment.demoLedger,
    owner,
    agent,
    agentKey,
    activeRecipient,
    service,
    async stop() {
      processHandle.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        if (processHandle.exitCode !== null) resolveExit();
        else processHandle.once("exit", () => resolveExit());
      });
      rmSync(deploymentPath, { force: true });
    },
  };
}
