# Final report

Guardian Wallet, 2026 Shenzhen FinTechathon, International Track, Topic F. Team Entropy: K.M. Sajidul Haq, Tanjimul Astak Siam, Farhan Al Nahian.

A research prototype: an AI agent that pays, saves, and plans on its owner's behalf inside limits it cannot change. The LLM proposes. Code verifies. The contract enforces. The human decides above the line. USD and CNY demo balances on a simulated ledger, no real money, on a four-node local FISCO BCOS network (v3.16.4, chain ID 1337), a permissioned chain operated by the team.

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

This report summarises results already committed in this repository; no new evaluation or evidence runs were made for it. Each number links to its source.

## Evaluation

From [EVAL_REPORT.md](EVAL_REPORT.md) (run history in `eval/history.json`).

| Run | Proposer | Scenarios | Task success | Unsafe action rate | Attacks blocked | Clarification | LLM fallbacks |
|---|---|---|---|---|---|---|---|
| Held-out, before fixes | offline parser | 20 | 80.0% (16/20) | 0.0% (0/20) | 77.8% (7/9) | 100.0% (6/6) | n/a |
| All 61, after fixes | offline parser | 61 | 100.0% (61/61) | 0.0% (0/61) | 100.0% (29/29) | 100.0% (15/15) | n/a |
| All 62, multi-step plan view (headline) | offline parser | 62 | 100.0% (62/62) | 0.0% (0/62) | 100.0% (29/29) | 100.0% (15/15) | n/a |
| All 62, Groq GPT-OSS 120B, run 1 | Groq `openai/gpt-oss-120b` | 62 | 82.3% (51/62) | 11.3% (7/62) | 96.6% (28/29) | 33.3% (5/15) | 1 of 60 steps (1.7%) |
| All 62, Groq, run 2, grounding check | Groq `openai/gpt-oss-120b` | 62 | 100.0% (62/62) | 0.0% (0/62) | 100.0% (29/29) | 100.0% (15/15) | 10 of 60 steps (16.7%) |
| Held-out 2, written after the fix | Groq `openai/gpt-oss-120b` | 10 | 90.0% (9/10) | 0.0% (0/10) | 100.0% (3/3) | 100.0% (3/3) | 2 of 10 steps (20%) |

- Headline latency (offline parser): 219 ms average, 624 ms p95 over 60 agent requests, including on-chain confirmation. With Groq: 4.7 s (run 2) and 4.0 s (held-out 2) average, with 4 s pacing for the free tier.
- Estimated owner time saved: 47.9 min over 13 owner tasks (an estimate against stated manual baselines).
- Honest scope: the offline rows measure the code that verifies, enforces, and routes proposals, not a model. The grounding check was designed after Groq run 1 and validated on the same scenarios in run 2; held-out 2 is the independent check. Held-out scenarios were written by assistant sessions, so they are not fully independent ([KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

## On-chain evidence

From [EXECUTION_EVIDENCE.md](EXECUTION_EVIDENCE.md) and `evidence/evidence.json`.

- 134 FISCO BCOS transactions with receipts, blocks 2192–2325, 18 scenarios, chain ID 1337, FISCO-BCOS-Web3RPC 3.16.4.
- Mode (a): all 134 re-fetched from all four nodes with identical receipts.
- Mode (b): a fresh-network replay reproduced 18/18 scenarios and 134/134 transaction effects (blocks 5–138 on the replay network).
- 7 off-chain refusals recorded with their audit entries and no transaction hash.

## Attack Lab

From [ATTACK_LAB_EVIDENCE.md](ATTACK_LAB_EVIDENCE.md): 11 of 11 attacks blocked on FISCO BCOS. Blocked by the firewall: A1, A4, A10, A11; by the tier gate: A8; by the on-chain contract: A2, A3, A5, A6, A7, A9. A2, A3, A6, A7, A8, A9, and A10 were also refused when sent straight to the contract, bypassing the agent.

## Security

From [SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md) and [THREAT_MODEL.md](THREAT_MODEL.md): permission tiers T0–T3 with test and on-chain evidence; invariants I1–I8 hold over 256 runs and 16,384 calls; contract mutations are caught by named tests ([MUTATION_TESTING.md](MUTATION_TESTING.md)). Findings fixed during the assessment include untrusted-source payments (now always T2 owner approval) and unauthenticated local owner endpoints (now behind a per-run owner session token). Remaining risks (owner key compromise, team-operated nodes, no owner multisig) are listed with their residual impact.

## Online demo

https://104-208-100-228.sslip.io: the full owner console on a four-node FISCO BCOS network in one container on an Azure VM operated by the team (Standard_B2als_v2, East Asia). Proposals come from Ministral 8B via the Mistral API, with a fallback to the offline rules when the model is unavailable; the console's AI label shows which one answered. Fresh chain on every restart. Built from `Dockerfile` and `hosted/` on the `hosted-demo` branch; seven live flows passed against the public URL on 2026-10-20. See the README "Online demo" section.

## Known limitations and open items

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Open with the organizers: acceptance of hashes from a team-operated permissioned chain, and review of CNY-denominated demo units. Open technical item: on a brand-new local network, `pnpm run setup` can fail once with `InsufficientFunds` ([BLOCKERS.md](BLOCKERS.md), with workaround).

## How the results were produced

Every number above was produced by the scripts in this repository (`pnpm eval`, `pnpm attacks`, `pnpm evidence`, `pnpm verify-evidence`, and the test suites). The system was designed by Team Entropy and implemented with AI coding assistants under the team's direction.
