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

## Attack Lab

The owner console's Attack Lab (`#/attack-lab`) runs eleven fixed adversarial scenarios with one click each, or all at once. The same scenarios run from the command line:

```bash
pnpm attacks            # all eleven, in-process on the local chain; writes docs/ATTACK_LAB_EVIDENCE.md
pnpm attacks A2 A9      # selected scenarios
pnpm attacks --api      # through the running agent API
```

Each scenario deploys its own `GuardianWallet` and `DemoLedger`, so shared demo balances are untouched. Results name the layer that stopped the attack (firewall, risk scorer, tier gate, or on-chain contract), the reason, and the transaction hash or decoded revert. Scenarios A2, A3, A6, A7, A8, A9, and A10 are also sent straight to the contract with the agent key. See [docs/ATTACK_LAB_EVIDENCE.md](docs/ATTACK_LAB_EVIDENCE.md).

Run every gate with:

```bash
pnpm test
pnpm lint
pnpm typecheck
```
