# Guardian Wallet

A research prototype for FinTechathon 2026 Topic F. The LLM proposes, deterministic code verifies, the contract enforces, and the human decides above the line.

The project uses a permissioned chain operated by the team, with local Anvil as the development fallback. It represents USD and BDT demo balances in a simulated ledger. There is no real money.

## Components

- `contracts/`: `DemoLedger`, `GuardianWallet`, deployment, unit/fuzz/invariant tests.
- `agent/`: intent parsing, firewall, policy mirror, simulation, restricted signer, risk scoring, planning, scheduling, and hash-chained audit.
- `risk-intel/`: synthetic payee checks and read-only cached USD/BDT FX snapshots, released after a verified service-fee receipt.
- `web/`: local dashboard application.
- `eval/`: scenario runner.

## Local development

```bash
pnpm install
cp .env.example .env
./scripts/dev-up.sh
pnpm risk-intel:dev
pnpm --filter agent dev
pnpm --filter web dev
```

The agent identity can call only `pay`, `requestApproval`, `saveToSavings`, and `payServiceFee`. Policy violations emit evidence and return `BLOCKED`. Owner and guardian may pause; only the owner may resume operation.

Run every gate with:

```bash
pnpm test
pnpm lint
pnpm typecheck
```
