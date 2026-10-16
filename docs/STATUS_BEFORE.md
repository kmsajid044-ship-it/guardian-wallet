# Status Before the Topic F Migration

Snapshot date: 16 October 2026. This is a research prototype using simulated ledger data and no real money.

## Repository state

- The latest pre-migration commit was `61e8542`, followed by eleven earlier project commits in the inspected fifteen-entry window.
- The working tree already contained one user-owned modification: `deployments/local.json`. It was not staged or changed during this inventory.
- The repository is a pnpm workspace containing contract, agent, web, evaluation, and Risk Intel API packages.
- Local Anvil development, deployment, seeding, transaction evidence, policy simulation, and end-to-end tests already exist.
- Local FISCO BCOS support does not yet exist and is the primary missing platform capability.

## Existing implementation

### Contracts

- `contracts/src/GuardianWallet.sol`: policy-enforced agent wallet, recipient and service allowlists, daily and operating budgets, pending approvals, pause controls, and savings operations.
- The former six-decimal balance contract and separate savings contract were identified as legacy components.
- `contracts/src/interfaces/IGuardianWallet.sol`: agent-facing interface.
- `contracts/script/Deploy.s.sol`: deployment and synthetic-data seeding.

### Agent and services

- Chain reads, policy pre-checks, simulation, restricted-key execution, append-only audit hashing, firewall checks, risk scoring, planning, scheduling, and LLM adapters are implemented under `agent/src/`.
- Fastify endpoints expose chat, state, pending approvals, plans, schedules, audit entries, and audit verification.
- `risk-intel/` provides paid synthetic payee checks and an FX snapshot endpoint with ledger-receipt verification.
- The current FX implementation includes a legacy currency pair outside the newly approved USD/CNY set.

### Web and evaluation

- `web/` contains a Vite/React application and a local-development owner-key guard.
- `eval/` contains the scenario runner and report generation skeleton.
- Existing documentation covers the threat model, technical design, security self-assessment, mutation testing, execution evidence, and evaluation report.

### Scripts

- `scripts/dev-up.sh` starts the local Anvil workflow.
- Package scripts previously included local deployment plus legacy remote deployment and evidence commands.

## Test inventory before migration

- Contract tests: four first-party suites, including one invariant suite and eight named invariants.
- Agent tests: fourteen files, including unit, integration, parity, key-boundary, and end-to-end coverage.
- Risk Intel tests: one file.
- Web tests: one file.
- Evaluation package: no automated test files yet.
- Vendored Foundry library tests are present under `contracts/lib/` but are not counted as project tests.

Verified runtime totals: contracts 90/90 with invariants 8/8, agent 56/56, Risk Intel 2/2, and web 3/3. Lint and strict type checking also passed. The evaluation package reported no automated test files.

## Crypto-era areas that must change

No feature should be deleted during the migration. These areas need renaming, replacement, or compatibility adapters:

1. **Network model:** remote deployment configuration, RPC defaults, hosted evidence links, environment examples, and package commands must be removed or converted to local-only operation.
2. **Primary ledger:** add local FISCO BCOS contracts, deployment automation, clients, receipt parsing, and parity tests while retaining local Anvil as the development fallback.
3. **Contract surface:** map the current four restricted agent operations to exactly `pay`, `requestApproval`, `saveToSavings`, and `payServiceFee`; owner-only arbitrary execution must remain unreachable from the agent identity.
4. **Money vocabulary:** replace legacy asset and savings-container naming across Solidity, TypeScript, UI, fixtures, generated manifests, tests, and documentation with approved demo-balance and savings terminology.
5. **Currency model:** expose only USD and CNY demo balances; make FX a read-only cached snapshot and remove the legacy unsupported pair.
6. **Risk Intel payment proof:** preserve the operating-budget and receipt-verification behavior while adapting it to the permissioned-chain transaction format.
7. **Evidence:** replace hosted evidence with reproducible local permissioned-chain receipts and audit hashes.
8. **Documentation and UI:** migrate legacy remote-network and financial-market language to the approved Topic F wording.
9. **Rule consistency:** the newly inserted hard-rules block necessarily spells out its prohibited vocabulary, and the instruction to keep the remainder of `CLAUDE.md` preserves legacy references. A follow-up migration must treat the rule block as the sole vocabulary exception while cleaning the rest of the repository.

## Immediate migration risks

- The current ABI, deployment manifest, client, and tests are tightly coupled to an EVM-style local development path.
- Renaming the four methods affects contracts, ABI definitions, simulations, pre-check logic, executor routing, tests, and documentation together.
- Existing transaction evidence and configuration must not accidentally initiate any network connection while being converted.
- The user-owned `deployments/local.json` modification must continue to be preserved.
