import { describe, expect, it } from "vitest";
import type { PolicyReader } from "./precheck.js";
import { precheckAction } from "./precheck.js";
const address="0x0000000000000000000000000000000000000001" as const;const id=`0x${"1".repeat(64)}` as const;
const base:PolicyReader={isCurrency:async(code)=>code==="USD"||code==="CNY",isPaused:async()=>false,isIntentUsed:async()=>false,getPolicy:async()=>({perTxLimit:500n,dailyLimit:1000n,approvalThreshold:200n,recipientCooldown:0n,pendingExpiry:100n,opsPerCallLimit:10n,opsDailyLimit:50n}),getRecipient:async()=>({allowed:true,activeAfter:0n,label:"Ana"}),getTimestamp:async()=>1n,getSpentToday:async()=>0n,getOpsSpentToday:async()=>0n,getBalance:async()=>1000n,getFeeAccount:async()=>address};
describe("policy pre-check",()=>{
  it("routes small and large payments",async()=>{await expect(precheckAction(base,{kind:"pay",currency: "USD",to:address,amount:100n,intentId:id})).resolves.toEqual({route:"EXECUTE"});await expect(precheckAction(base,{kind:"request_approval",currency: "USD",to:address,amount:200n,intentId:id})).resolves.toEqual({route:"NEEDS_APPROVAL"});});
  it("blocks policy violations",async()=>{await expect(precheckAction({...base,isPaused:async()=>true},{kind:"pay",currency: "USD",to:address,amount:1n,intentId:id})).resolves.toMatchObject({route:"BLOCKED",reason:"PAUSED"});await expect(precheckAction({...base,getRecipient:async()=>({allowed:false,activeAfter:0n,label:""})},{kind:"pay",currency: "USD",to:address,amount:1n,intentId:id})).resolves.toMatchObject({reason:"RECIPIENT_NOT_ALLOWED"});});
  it("keeps service fees on their own budget",async()=>{await expect(precheckAction(base,{kind:"service_fee",amount:10n,intentId:id})).resolves.toEqual({route:"EXECUTE"});await expect(precheckAction({...base,getOpsSpentToday:async()=>45n},{kind:"service_fee",amount:10n,intentId:id})).resolves.toMatchObject({reason:"OVER_OPS_DAILY"});});
  it("refuses a currency the ledger has not listed, in the contract's position", async () => {
    await expect(precheckAction(base, { kind: "pay", currency: "SGD", to: address, amount: 1n, intentId: id })).resolves.toEqual({ route: "BLOCKED", reason: "UNKNOWN_CURRENCY" });
    await expect(precheckAction(base, { kind: "save", currency: "SGD", amount: 1n, intentId: id })).resolves.toEqual({ route: "BLOCKED", reason: "UNKNOWN_CURRENCY" });
    await expect(precheckAction({ ...base, isPaused: async () => true }, { kind: "pay", currency: "SGD", to: address, amount: 1n, intentId: id })).resolves.toMatchObject({ reason: "PAUSED" });
    await expect(precheckAction(base, { kind: "pay", currency: "CNY", to: address, amount: 100n, intentId: id })).resolves.toEqual({ route: "EXECUTE" });
  });
});
