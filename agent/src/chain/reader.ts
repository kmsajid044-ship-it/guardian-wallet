import { getAddress, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import type { PolicyReader } from "../policy/precheck.js";
import type { Policy, Recipient } from "../policy/types.js";
import { demoLedgerAbi, guardianWalletAbi } from "./abi.js";
import { toCurrencyCode } from "../currency/registry.js";

export class GuardianReader implements PolicyReader {
  constructor(
    private readonly client: PublicClient<Transport, Chain>,
    readonly walletAddress: Address,
    private readonly ledgerAddress: Address,
    private readonly timestampSource?: () => bigint,
  ) {}
  async isPaused(): Promise<boolean> { return this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "paused" }); }
  async isIntentUsed(intentId: Hex): Promise<boolean> { return this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "usedIntent", args: [intentId] }); }
  async getPolicy(): Promise<Policy> { return { ...await this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "getPolicy" }) }; }
  async getRecipient(recipient: Address): Promise<Recipient> { return { ...await this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "getRecipient", args: [recipient] }) }; }
  async getTimestamp(): Promise<bigint> { return this.timestampSource ? this.timestampSource() : (await this.client.getBlock()).timestamp; }
  async getSpentToday(): Promise<bigint> { return this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "spentToday" }); }
  async getOpsSpentToday(): Promise<bigint> { return this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "opsSpentToday" }); }
  async getBalance(currency: string): Promise<bigint> { return this.client.readContract({ address: this.ledgerAddress, abi: demoLedgerAbi, functionName: "balanceOf", args: [this.walletAddress, toCurrencyCode(currency)] }); }
  async isCurrency(currency: string): Promise<boolean> { return this.client.readContract({ address: this.ledgerAddress, abi: demoLedgerAbi, functionName: "isCurrency", args: [toCurrencyCode(currency)] }); }
  async getFeeAccount(): Promise<Address> { return getAddress(await this.client.readContract({ address: this.walletAddress, abi: guardianWalletAbi, functionName: "feeAccount" })); }
}
