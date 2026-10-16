import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
loadEnvFile({ path: resolve(repoRoot, ".env"), quiet: true });

// Public configuration only. The agent signing secret is deliberately absent and is read
// exclusively inside src/exec/ (CLAUDE.md security rule 6).
const ConfigSchema = z.object({
  AGENT_PORT: z.coerce.number().int().positive().default(8787),
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(1337),
  DEPLOYMENTS_FILE: z.string().min(1).default("./deployments/fisco.json"),
  AUDIT_DB_PATH: z.string().min(1).default("./agent/data/audit.sqlite"),
  LLM_PROVIDER: z.enum(["anthropic", "openai_compat", "mock"]).default("mock"),
  OWNER_TIMEZONE: z.string().min(1).default("Asia/Shanghai"),
  OWNER_ACTIVE_HOURS: z.string().regex(/^(?:[01][0-9]|2[0-3])-(?:[01][0-9]|2[0-4])$/).default("08-22"),
  RISK_INTEL_URL: z.string().url().optional(),
});

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const DeploymentSchema = z.object({
  network: z.string().min(1),
  chainId: z.number().int().positive(),
  deployedAt: z.number().int().nonnegative(),
  guardianWallet: AddressSchema,
  demoLedger: AddressSchema,
  owner: AddressSchema,
  agent: AddressSchema,
  guardian: AddressSchema,
  feeAccount: AddressSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}

export function loadDeployment(config: Config = loadConfig()): Deployment {
  const path = resolveRepoPath(config.DEPLOYMENTS_FILE);
  const deployment = DeploymentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (deployment.chainId !== config.CHAIN_ID) {
    throw new Error(`deployment chainId ${deployment.chainId} does not match configured CHAIN_ID ${config.CHAIN_ID}`);
  }
  return deployment;
}

export function resolveRepoPath(path: string): string {
  if (path === ":memory:") return path;
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}
