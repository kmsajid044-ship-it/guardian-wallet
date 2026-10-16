## HARD RULES (FinTechathon 2026, Topic F)
1. Never connect to, deploy on, or reference any public blockchain, public testnet or public RPC. Only local FISCO BCOS (primary) and local Anvil (dev/fallback).
2. Forbidden words anywhere (code, comments, docs, UI, commits): cryptocurrency, crypto asset, stablecoin, token sale, coin, mining, airdrop, faucet, mainnet, trading, yield farming, RMB, CNY, sepolia, Hong Kong stablecoin. "token" only for auth/LLM tokens, never money.
3. Approved wording: "simulated ledger", "demo units", "USD and BDT demo balances", "no real money", "permissioned chain operated by the team", "research prototype".
4. Currencies: USD and BDT only. FX rates = read-only cached snapshot.
5. Never print, log or commit private keys. Keys only in git-ignored .env; .env.example has placeholders.
6. Agent may call only four contract functions (pay, requestApproval, saveToSavings, payServiceFee). No generic execute.
7. Every policy violation emits an event, returns BLOCKED, and is recorded with its tx hash.
8. Work autonomously, no questions. Commit at the end of each task with all tests green. If blocked >45 min, write exact errors to docs/BLOCKERS.md and continue with the rest.
9. Never delete features to save time.

# CLAUDE.md — Guardian Wallet

## Project

Competition entry for the 2026 Shenzhen FinTechathon, International Track, Topic F. Full design: `SPEC.md`.

Core principle: **The LLM proposes. Code verifies. The contract enforces. The human decides above the line.**

The system is a research prototype with USD and BDT demo balances, a simulated ledger, and no real money. Local FISCO BCOS is primary; local Anvil is the development fallback.

## Stack

- `contracts/`: Foundry, Solidity, OpenZeppelin access controls
- `agent/`: Node, strict TypeScript, Fastify, viem, zod, SQLite, scheduler
- `risk-intel/`: synthetic payee checks and cached USD/BDT FX
- `web/`: Vite, React, TypeScript, Tailwind
- `eval/`: scenario runner

## Commands

```bash
pnpm install
cd contracts && forge build && forge test -vv
./scripts/chain-up.sh
./scripts/deploy-fisco.sh
./scripts/seed.sh
./scripts/dev-up.sh
pnpm --filter agent dev
pnpm --filter agent test:parity
pnpm risk-intel:dev
pnpm --filter web dev
pnpm --filter web test:e2e
pnpm eval
pnpm lint && pnpm typecheck && pnpm test
./scripts/chain-down.sh
```

If Foundry is unavailable in a non-interactive shell, add `$HOME/.foundry/bin` to `PATH`.

## Security

1. Proposals use contact IDs; deterministic code resolves allowlisted addresses.
2. Every direct, planned, and scheduled action uses firewall, policy pre-check, simulation, risk scoring, routing, restricted signing, and audit.
3. Numbers shown to users come from deterministic code.
4. Untrusted content is labelled and delimited as data.
5. The signing value is read only under `agent/src/exec/` and is never logged, sent to an LLM, or sent to the browser.
6. Browser owner signing uses an injected wallet outside local development. The local demo owner setting must fail production builds.

## Conventions

- Strict TypeScript; validate external input with zod.
- Amounts use `bigint` minor units internally and decimal strings at user boundaries.
- Audit entry hash is `sha256(previous hash + canonical JSON)`.
- Bundle web dependencies; no external font or CDN dependency.
- Label all demonstration data synthetic.
- Keep third-party license notices current.
- Keep permission tiers T0–T3 aligned with `SPEC.md`.

## Testing

- Unit coverage for every function and violation reason.
- Fuzz amounts and timestamps.
- Maintain invariants I1–I8.
- Agent pre-check predictions must match local contract simulation.
- Every Attack Lab scenario is also an evaluation scenario.
- A task is complete only when forbidden-content check, lint, typecheck, and all tests pass.

## Workflow

- Restate the goal and files before edits; plan contract and pipeline work.
- Write security tests before behavior changes.
- Preserve unrelated user changes.
- Update `SPEC.md` when design decisions change.
- Commit each completed task with a clear permitted message.
