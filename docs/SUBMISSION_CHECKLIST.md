# Submission checklist

The six official submission items for the 2026 Shenzhen FinTechathon, International Track, Topic F, mapped to the files in this repository. Status as of 2026-10-20.

Research prototype: USD and CNY demo balances on a simulated ledger, no real money, on a permissioned chain operated by the team (local FISCO BCOS).

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

| # | Item | Files and links | Status |
|---|---|---|---|
| 1 | Technical documentation | [docs/TECHNICAL.md](TECHNICAL.md) (architecture, pipeline, LLM layer and grounding, risk score, tier gate, firewall, on-chain policy, invariants I1–I8, audit chain, Working / Partial / Planned); [SPEC.md](../SPEC.md) (full design); [docs/FISCO_LOCAL.md](FISCO_LOCAL.md); [docs/EVAL_REPORT.md](EVAL_REPORT.md); [docs/LLM_EVIDENCE.md](LLM_EVIDENCE.md); [docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Present |
| 2 | Deck | [docs/Guardian_Wallet_Deck.pdf](Guardian_Wallet_Deck.pdf) | Present |
| 3 | Demo video | [docs/Guardian_Wallet_Demo.mp4](Guardian_Wallet_Demo.mp4) (2:04, captioned, no audio); narration and clicks in [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Present |
| 4 | Source code with README, GitHub link, deployment, tests | Source: this repository, https://github.com/kmsajid044-ship-it/guardian-wallet (public). [README.md](../README.md): setup (`pnpm run setup && pnpm demo`), Real AI (optional), 60-second demo, Deployment (local FISCO BCOS primary, local Anvil fallback; `deployments/fisco.json`), Tests and evidence. Tests: agent 201, contracts 44 (unit, fuzz, invariants I1–I8), eval harness 28, web unit 7, Risk Intel 2, Playwright 30 (plus 4 opt-in walkthroughs); `pnpm lint && pnpm typecheck && pnpm test` | Present |
| 5 | Security self-assessment | [docs/SECURITY_SELF_ASSESSMENT.md](SECURITY_SELF_ASSESSMENT.md) (permission tiers T0–T3 with test and on-chain evidence, known risks, LLM layer); [docs/THREAT_MODEL.md](THREAT_MODEL.md); [docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md); [docs/MUTATION_TESTING.md](MUTATION_TESTING.md) | Present |
| 6 | Execution evidence with real on-chain transaction hashes | [docs/EXECUTION_EVIDENCE.md](EXECUTION_EVIDENCE.md): 134 FISCO BCOS transactions (blocks 2192–2325) with receipts in `evidence/receipts/`, `evidence/evidence.json`, a node data snapshot in `evidence/node-snapshot/`, all re-verified on four nodes and replayed on a fresh network; [docs/ATTACK_LAB_EVIDENCE.md](ATTACK_LAB_EVIDENCE.md) (11 of 11 attacks blocked); LLM run evidence in `eval/llm-runs/`. Re-check: `pnpm verify-evidence --running`, `pnpm verify-evidence --fresh` | Present; organizer acceptance of permissioned-chain hashes not yet confirmed |

## Before submitting

- [x] Make the GitHub repository public, or share it with the organizers.
- [x] Build the deck.
- [x] Record the demo video (docs/Guardian_Wallet_Demo.mp4, 2:04, captioned, no audio).
- [ ] Confirm with the organizers that hashes from a team-operated permissioned FISCO BCOS network are accepted as execution evidence, and whether the challenge bonus applies.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm --filter web test:e2e` on the final commit.
