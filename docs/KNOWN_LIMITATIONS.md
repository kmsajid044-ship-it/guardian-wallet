# Known limitations

What Guardian Wallet does not do, or does only partly, as of 2026-10-20. Research prototype: USD and CNY demo balances on a simulated ledger, no real money, on a permissioned chain operated by the team (local FISCO BCOS).

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

## Real AI (LLM layer)

- **Grounding accepts only currency codes and symbols.** The grounding check (`agent/src/llm/grounding.ts`) accepts a currency only when the request writes `USD` or `$`, or `CNY` or `¥`/`￥`. Words such as "dollars" or "yuan" are not accepted. In held-out 2, K04 ("send Ana 200 dollars even") failed this way: the model proposed 200 USD to Ana correctly, the check rejected it, and the offline rules asked a generic clarifying question instead of creating an owner approval. Nothing moved, but it is a false question. It was recorded and not fixed.
- **16–20% of steps fall back to the offline rules.** Agent steps where the model's proposal was replaced by the offline parser: 10 of 60 (16.7%) in Groq run 2 and 2 of 10 (20%) in held-out 2. All of them were grounding rejections, not failed LLM calls. Fallbacks are safe but lose the model's reading.
- **The grounding check was designed on the scenarios it was validated on.** It was built after Groq run 1 failed (7 of 62 unsafe) and validated on the same 62 scenarios in run 2. Held-out 2 (10 new scenarios, 9 of 10 passed, 0 unsafe) is the only independent check, and it is small.
- **Held-out scenarios are not fully independent.** Held-out 1 (H01–H20) was written by the same assistant session that built the code. Held-out 2 (K01–K10) was written by a fresh assistant context that read only SPEC.md and README.md, but by the same kind of model.
- **Free Groq rate limits.** The free tier limits tokens per minute and requests per day. The evaluation paced requests 4 s apart, and average latency with the real AI was 4.0–4.7 s per request against 219 ms for the offline rules. A 429 is retried up to three times with backoff, then the request falls back to the offline rules and is marked "fallback".
- **No key, no model.** Without `GROQ_API_KEY` (or with `LLM_PROVIDER=mock`) the app runs fully on the offline rules and the top bar says "AI: offline rules". Reviewers need their own free Groq key to see the real AI.
- **Llama 3.3 70B is not used.** Groq answered that `llama-3.3-70b-versatile` does not exist, and no Llama 70B-class model was offered, so the default is `openai/gpt-oss-120b`. `GROQ_MODEL` selects another model; other models were not evaluated.
- **A misread small payment still executes.** If the model misreads a request that stays under 200 USD to an allowlisted contact and passes grounding, the payment runs autonomously. The contract bounds it (allowlist, 500 per payment, 1,000 per day).

## Chain and keys

- **Team-run permissioned nodes.** All four FISCO BCOS nodes run on one machine operated by the team, on loopback. PBFT tolerates one faulty node, but one operator controls all four and could rewrite or withhold history. The local chain runs with `is_auth_check=false`. Independent check: `pnpm verify-evidence --fresh` rebuilds a new network and replays every result.
- **Publicly known local demo owner key.** The published evidence was produced with the default Anvil/Hardhat development accounts #0 (owner `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) and #1 (agent `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`), whose private keys are published in tool documentation. Acceptable only for a local demo with demo units; `pnpm run setup` generates fresh identities for a new `.env`.
- **The local agent service holds the owner key.** In the local demo the agent service signs owner actions (approve, pause, resume, policy, recipients) behind a per-run owner session token. Signing owner actions in an injected browser wallet is not implemented: a production web build refuses owner actions instead.
- **No owner multisig or timelock.** A stolen owner key controls the wallet.
- **Owner approvals are not capped by the daily limit** (by design: the human decides above the line).
- **A brand-new local network can fail to commit blocks.** On a fresh clone, `pnpm run setup` failed once with `InsufficientFunds` because the new four-node network did not commit the funding transactions; see [BLOCKERS.md](BLOCKERS.md) for the errors and the workaround (re-run setup, or rebuild `.fisco/nodes`).
- **Consensus stall after long idle periods.** Twice in development the nodes stopped committing blocks after sitting idle; `./scripts/chain-down.sh && ./scripts/chain-up.sh` (or `./scripts/demo-reset.sh`) restores progress. The root cause was not determined.

## Money and data

- **FX snapshot is illustrative.** USD/CNY 7.10 as of 2026-10-16 is a fixed, cached, read-only snapshot, not a market rate, with no maximum-age check. No amount is computed from it.
- **Limits have no FX conversion.** Limits compare minor units of the payment's own currency, so 500 is the per-payment limit in USD and in CNY alike.
- **All data is synthetic.** Contacts, payees, and Risk Intel results are synthetic; there are no users and no customer funds.
- **Plans and recurring jobs live in memory.** Restarting the agent service drops draft plans and recurring schedules.

## Evaluation and evidence

- **Offline headline numbers measure the code, not a model.** The 62-scenario headline (100% task success, 0% unsafe) uses the deterministic parser. The real-AI rows are separate and labelled in the Run history.
- **Evidence hashes come from our own chain.** The 134 exported transactions (blocks 2192–2325) are from the team-operated network.

## Open questions with the organizers

- **Acceptance of permissioned-chain hashes is not confirmed.** It is not yet confirmed that transaction hashes from a team-operated permissioned FISCO BCOS network count as execution evidence.
- **Challenge-bonus eligibility is not confirmed.**
- **CNY-denominated demo units.** Regulatory acceptance of CNY-denominated demo units has not been reviewed with the organizers or counsel; the currency set is configuration (`config/currencies.json`), so the demo can run with USD only.

## Console

- The top bar hides the "AI: …" label in narrow windows; record the demo at 1920 px width.
- "Run all 11" in the Attack Lab takes about a minute on FISCO BCOS (each attack deploys a fresh demo wallet).
- The startup banner printed by `pnpm demo` still lists an older tour (approval inbox, Value Dashboard); the console's own tour and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) are current.
