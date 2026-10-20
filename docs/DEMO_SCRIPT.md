# Demo script (5 minutes)

Narration and exact clicks for the demo video. It follows the current owner console (four tabs: Home, Activity, Controls, Security) with the real AI on (Groq, `openai/gpt-oss-120b`). Every on-screen text below was read from the running console on local FISCO BCOS on 2026-10-20.

Research prototype: USD and CNY demo balances on a simulated ledger, no real money, on a permissioned chain operated by the team.

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

## One-time setup

1. First time only: `pnpm run setup` (installs, builds, starts the four FISCO BCOS nodes, deploys and seeds).
2. In the git-ignored `.env`, set `GROQ_API_KEY=<your free key from https://console.groq.com/keys>` and `LLM_PROVIDER=groq`. Without a key the demo still works and the top bar says "AI: offline rules".
3. Right before recording, run:

   ```bash
   ./scripts/demo-reset.sh
   ```

   It stops any running demo, restarts the nodes, deploys fresh contracts, seeds $5,000.00 and ¥35,000.00 of demo units, sets the old activity log aside, and starts the console on http://localhost:3000. Wait for "Press Ctrl-C to stop." (about one to two minutes).
4. Open http://localhost:3000 in a browser window 1920 × 1080 wide. At this width the top bar shows "FISCO BCOS · 1337 · #<block>" and "AI: GPT-OSS 120B via Groq" (narrower windows hide the AI label).
5. If the first-visit tour appears ("Step 1 of 3 · Tell your AI what to do"), click **Skip**. Leave **Technical details** off.
6. Optional rehearsal: run the whole script once, then run `./scripts/demo-reset.sh` again so the recording starts clean.

Timings assume each AI request takes 2–8 seconds (Groq with an explanation, plus on-chain confirmation). "Run all 11" takes about a minute on FISCO; speed up that wait in editing.

## Script

### 0:00 Hook

*Screen:* Home, two balance cards ($5,000.00 USD, ¥35,000.00 CNY) and the box "What should your AI do?".

> What happens when AI can spend your money? AI agents are starting to pay bills and move savings for people. One wrong reading, one hidden instruction in an invoice, or one stolen key, and the money is gone.

### 0:25 Solution

> Guardian Wallet is a trust and control layer for AI finance: the AI proposes, deterministic code verifies, a smart contract enforces the limits, and you decide everything above the line.

*Point at* the top bar: "FISCO BCOS · 1337" (our local permissioned chain) and "AI: GPT-OSS 120B via Groq" (a real language model reads the requests).

### 0:50 A small payment runs on its own

1. Click the box **What should your AI do?** and type exactly: `Pay Ana $50`
2. Press **Enter**.
3. The receipt shows **Done** and "Paid $50.00 to Ana".
4. Click **View proof**: it shows the transaction hash and block. Click **Verify**: "Receipt success · block <n>".

> Fifty dollars to a known contact is under my limit, so the AI pays on its own. Before it signed, code checked the request for injection, mirrored the contract policy, simulated the call, and scored the risk. View proof is the real transaction, and Verify asks the chain node for the receipt.

### 1:30 Above the line, the human decides

1. Type exactly: `Pay Ana $250` and press **Enter**.
2. The receipt shows **Needs your OK** and "Needs your OK: $250.00 to Ana. It's above your $200 limit.", with **Approve** and **Decline**.
3. Click **Approve**. The receipt changes to **Done**, "Paid $250.00 to Ana"; a toast says "Approved and paid."

> Two hundred and fifty is above my two-hundred line. The AI cannot pay it; it can only ask. My approval is an on-chain transaction from my own key.

### 2:00 Over the limit, the contract refuses

1. Type exactly: `Pay Ana $600` and press **Enter**.
2. The receipt shows **Blocked** and "Blocked: $600.00 is above your $500 limit."

> Six hundred is above the per-payment limit. The contract itself refused it, and the refusal is recorded on chain with its own hash.

### 2:20 Why this action?

1. Click the **Technical details** switch in the top bar.
2. The $600 card now shows the code `BLOCKED`, Permission "AI can do alone" `T1`, and the **Why this action?** panel: Risk score "Not scored", Your OK "Not required", Decided by "contract · OVER PER TX LIMIT", and "Contract policy refused the action with OVER_PER_TX_LIMIT; the refusal is recorded on chain.", with the transaction hash and block.
3. Click **Technical details** again to turn it off.

> For reviewers, one switch shows the codes behind each decision: which layer decided, the permission tier, the risk factors, and the transaction.

### 2:50 The kill switch

1. Click **Pause AI** (bottom of Home). The dialog "Pause AI?" says "The AI can't pay anyone until you resume."
2. Click **Pause AI** in the dialog. The banner "Paused. The AI can't pay anyone." appears; the toast says "AI paused. Confirmed on chain."
3. Type exactly: `Pay Ana $20` and press **Enter**. The receipt shows **Blocked**: "Blocked: the AI is paused."
4. Click **Resume AI** in the banner. The toast says "AI resumed. Confirmed on chain."

> One button stops everything, enforced by the contract. Only the owner can resume; the AI's key cannot.

### 3:20 Eleven attacks

1. Click the **Security** tab. **Attack Lab** opens: "Watch eleven real attacks try to misuse the AI, and see what stops each one."
2. Click **Run all 11**. Each attack runs on a fresh demo wallet on FISCO BCOS (about a minute; speed up in editing). The header ends at "11 of 11 attacks blocked", and each row names who stopped it: the AI firewall, the permission check, or the blockchain contract.
3. Scroll to **A9 Direct ledger bypass** (the stolen-key attack): "A fully compromised agent key calls the contracts directly, skipping every off-chain check." Result: **Blocked**, "Stopped by the blockchain contract", "Revert: NotController", with its transaction hash.

> Hidden instructions, split payments, replayed approvals, a fake owner, and the worst case: a stolen agent key calling the contract directly. All eleven are blocked. Even with the key, the attacker hits the contract's rules.

### 3:50 Verify the evidence yourself

1. Click **Evidence Inspector** (Security). It reads "Every money movement is recorded on our FISCO BCOS chain. Press Verify to check it yourself." with the groups Done 116, Refused on-chain 18, Blocked before the chain 7.
2. Click the **Refused on-chain** tab. The first card is **E06 Over-limit refusal** (`requestApproval(ana, 600 USD)` refused, block 2206).
3. Click **Verify** on it. The result reads "Match · receipt in block 2206 on chain 1337, equal to the export".

> These are 134 exported transactions from our permissioned FISCO BCOS network. Verify fetches each one from the node and compares it with the export. Anyone can also rebuild a fresh network and replay every result.

### 4:15 The real-AI story

1. Click **Evaluation** (Security) and scroll to **Run history**.
2. Point at the rows "all 62, Groq GPT-OSS 120B, run 1" (unsafe 11.3%), "all 62, Groq GPT-OSS 120B, run 2, grounding check" (unsafe 0%), and "held-out 2, Groq + grounding, written after the fix" (90.0%, 9 of 10; unsafe 0%).

> We tested with a real model, not just rules. On its own, the real AI invented details in 11% of cases: a currency nobody wrote, an amount read from words. Our grounding layer only lets through what the user actually wrote, and brought unsafe actions to 0%. On 10 new unseen scenarios, written after the fix: 90% success, 0% unsafe. The one miss asked a question it did not need to; nothing moved.

### 4:40 Close

*Screen:* back to **Home**.

> Guardian Wallet lets AI handle your financial tasks without giving up control of your money. The AI proposes, code verifies, the contract enforces, and the human decides above the line. Research prototype, demo units only, no real money. Code, evaluation, and every transaction hash are in the repository.

## Numbers used, and where they come from

| Claim | Value | Source |
|---|---|---|
| Attack Lab | 11 of 11 blocked | Attack Lab page; [ATTACK_LAB_EVIDENCE.md](ATTACK_LAB_EVIDENCE.md) |
| Exported evidence | 134 transactions (116 executed, 18 refused on-chain), 7 off-chain blocks | [EXECUTION_EVIDENCE.md](EXECUTION_EVIDENCE.md), Evidence Inspector |
| Real AI without grounding | Unsafe 11.3% (7 of 62) | [EVAL_REPORT.md](EVAL_REPORT.md) Run history, run 1 |
| Real AI with grounding | Unsafe 0% (0 of 62), task success 100% | Run 2 (same scenarios the check was designed on) |
| Unseen scenarios | Task success 90% (9 of 10), unsafe 0% | Held-out 2; [LLM_EVIDENCE.md](LLM_EVIDENCE.md) |
