import { getAddress, type Address, type Chain, type PublicClient, type Transport } from "viem";
import { demoLedgerAbi, guardianWalletAbi } from "./abi.js";
import type { Deployment } from "../config.js";
import { currencies, disclaimerFor, fromCurrencyCode, fromMinorUnits, toCurrencyCode } from "../currency/registry.js";

const statuses = ["NONE", "PENDING", "EXECUTED", "REJECTED", "EXPIRED"] as const;

export type CurrencyBalance = { code: string; name: string; available: string; savings: string; disclaimer?: string };

export class ChainStateReader {
  constructor(private readonly client: PublicClient<Transport, Chain>, private readonly deployment: Deployment, private readonly contacts: Readonly<Record<string, Address>>) {}

  async state(): Promise<Record<string, string | boolean | CurrencyBalance[]>> {
    const wallet = getAddress(this.deployment.guardianWallet);
    const ledger = getAddress(this.deployment.demoLedger);
    const read = <T>(request: Parameters<PublicClient<Transport, Chain>["readContract"]>[0]) => this.client.readContract(request) as Promise<T>;
    const [paused, policy, spent, ops] = await Promise.all([
      this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "paused" }),
      this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "getPolicy" }),
      this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "spentToday" }),
      this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "opsSpentToday" }),
    ]);
    const balances = await Promise.all(currencies().map(async (unit): Promise<CurrencyBalance> => {
      const code = toCurrencyCode(unit.code);
      const [available, savings] = await Promise.all([
        read<bigint>({ address: ledger, abi: demoLedgerAbi, functionName: "balanceOf", args: [wallet, code] }),
        read<bigint>({ address: ledger, abi: demoLedgerAbi, functionName: "savingsBalance", args: [wallet, code] }),
      ]);
      const disclaimer = disclaimerFor(unit.code);
      return { code: unit.code, name: unit.name, available: fromMinorUnits(unit.code, available), savings: fromMinorUnits(unit.code, savings), ...(disclaimer ? { disclaimer } : {}) };
    }));
    return {
      paused, balances,
      spentToday: formatUnits(spent), remainingDaily: formatUnits(policy.dailyLimit > spent ? policy.dailyLimit - spent : 0n), opsSpentToday: formatUnits(ops),
      perTxLimit: formatUnits(policy.perTxLimit), dailyLimit: formatUnits(policy.dailyLimit), approvalThreshold: formatUnits(policy.approvalThreshold),
      recipientCooldown: policy.recipientCooldown.toString(), pendingExpiry: policy.pendingExpiry.toString(),
      opsPerCallLimit: formatUnits(policy.opsPerCallLimit), opsDailyLimit: formatUnits(policy.opsDailyLimit),
    };
  }

  async recipients(): Promise<Array<Record<string, string | boolean>>> {
    const wallet = getAddress(this.deployment.guardianWallet);
    return Promise.all(Object.entries(this.contacts).map(async ([id, address]) => {
      const recipient = await this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "getRecipient", args: [address] });
      return { id, address, label: recipient.label, allowed: recipient.allowed, activeAfter: recipient.activeAfter.toString() };
    }));
  }

  async pending(): Promise<Array<Record<string, string>>> {
    const wallet = getAddress(this.deployment.guardianWallet);
    const count = await this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "pendingCount" });
    const reverse = new Map(Object.entries(this.contacts).map(([id, address]) => [getAddress(address), id]));
    const result: Array<Record<string, string>> = [];
    for (let id = 1n; id <= count; id++) {
      const p = await this.client.readContract({ address: wallet, abi: guardianWalletAbi, functionName: "getPending", args: [id] });
      const code = fromCurrencyCode(p.currency);
      const disclaimer = disclaimerFor(code);
      result.push({
        id: id.toString(), currency: code, recipient: p.to, recipientContactId: reverse.get(getAddress(p.to)) ?? "unknown", amount: formatUnits(p.amount),
        intentId: p.intentId, createdAt: p.createdAt.toString(), expiresAt: p.expiresAt.toString(), status: statuses[p.status] ?? "UNKNOWN",
        ...(disclaimer ? { disclaimer } : {}),
      });
    }
    return result;
  }
}

/** Policy limits are minor units with 6 decimals, the precision of every configured demo unit. */
export function formatUnits(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
