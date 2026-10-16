import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { guardianWalletAbi } from "../chain/abi.js";
import { toCurrencyCode } from "../currency/registry.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
loadEnvFile({ path: resolve(repoRoot, ".env"), quiet: true });

const signingValue = process.env.AGENT_PRIVATE_KEY;
if (!signingValue?.match(/^0x[0-9a-fA-F]{64}$/)) throw new Error("AGENT_PRIVATE_KEY is not configured");
const account = privateKeyToAccount(signingValue as Hex);
const deployment = JSON.parse(readFileSync(resolve(repoRoot, "deployments/fisco.json"), "utf8")) as {
  guardianWallet: `0x${string}`;
};
const recipient = process.env.DEMO_CONTACT_1_ADDRESS;
if (!recipient?.match(/^0x[0-9a-fA-F]{40}$/)) throw new Error("DEMO_CONTACT_1_ADDRESS is not configured");

const rpcUrl = process.env.FISCO_RPC_URL ?? "http://127.0.0.1:8545";
const chain = defineChain({
  id: 1337,
  name: "local-fisco",
  nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const intentId = keccak256(stringToHex(`fisco-t1-${Date.now()}`));

const hash = await walletClient.writeContract({
  address: getAddress(deployment.guardianWallet),
  abi: guardianWalletAbi,
  functionName: "pay",
  args: [getAddress(recipient), toCurrencyCode("USD"), 25_000_000n, intentId],
  gasPrice: 0n,
});
process.stderr.write(`Submitted T1 payment: ${hash}\n`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 30_000 });
const result = {
  transactionHash: receipt.transactionHash,
  status: receipt.status,
  blockNumber: receipt.blockNumber.toString(),
  from: receipt.from,
  to: receipt.to,
  gasUsed: receipt.gasUsed.toString(),
  intentId,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
