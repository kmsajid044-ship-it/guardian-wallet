import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { createChainAdapter, type OwnerAction, type Receipt } from "../chain/ChainAdapter.js";
import type { Config, Deployment } from "../config.js";

const OwnerEnvironmentSchema = z.object({ OWNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

export class OwnerExecutor {
  private constructor(
    private readonly adapter: ReturnType<typeof createChainAdapter>,
    private readonly account: ReturnType<typeof privateKeyToAccount>,
  ) {}

  static create(config: Config, deployment: Deployment, environment: NodeJS.ProcessEnv): OwnerExecutor {
    const parsed = OwnerEnvironmentSchema.parse(environment);
    const account = privateKeyToAccount(parsed.OWNER_PRIVATE_KEY as Hex);
    if (getAddress(account.address) !== getAddress(deployment.owner)) throw new Error("owner signing value does not match deployment owner");
    return new OwnerExecutor(createChainAdapter(config, deployment), account);
  }

  async submit(action: OwnerAction): Promise<Receipt> {
    return this.adapter.getReceipt(await this.adapter.ownerTx(action, this.account));
  }
}
