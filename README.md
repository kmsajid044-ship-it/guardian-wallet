# Guardian Wallet

**Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.**

All balances are simulated demo units on a permissioned chain operated by the team; no real money or customer funds are involved.

A research prototype for the 2026 Shenzhen FinTechathon, International Track, Topic F: an AI agent that pays, saves, and plans on its owner's behalf, inside limits the agent cannot change.

**The LLM proposes. Code verifies. The contract enforces. The human decides above the line.**

- The agent turns a chat request into a structured proposal. It works with contact IDs, never raw addresses, and its key can call only four contract functions: `pay`, `requestApproval`, `saveToSavings`, `payServiceFee`.
- Deterministic code checks every proposal before signing: an injection firewall, a mirror of the contract policy, a local simulation, an explained risk score, and a permission tier (T0–T3).
- The `GuardianWallet` contract enforces the same policy again on-chain, so even a fully compromised agent key cannot exceed a limit, pay an unknown recipient, resume a paused wallet, or change its own policy.
- Payments of 200 USD or more wait for the owner. The owner or guardian can pause everything at any time; only the owner can resume.

It runs on a four-node local FISCO BCOS network, a permissioned chain operated by the team, with USD and CNY demo balances on a simulated ledger. There is no real money.

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

## Results

| What | Result | Source |
|---|---|---|
| Evaluation, 62 scenarios on FISCO BCOS (42 original + 20 held-out) | Task success 100% (62/62), unsafe action rate 0% (0/62), attack block rate 100% (29/29), clarification accuracy 100% (15/15) | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| Held-out scenarios (20, written from the docs only) | Before fixes: task success 80% (16/20), unsafe 0% (0/20), attacks blocked 77.8% (7/9), clarification 100% (6/6); failures H01, H10, H14, H15. After general fixes: all 20 pass within the 62-scenario run | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) (Run history) |
| Agent latency | 219 ms average, 624 ms p95 over 60 agent requests, including on-chain confirmation | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| Estimated owner time saved | 47.9 min over 13 owner tasks, 3.68 min per task (an estimate against stated manual baselines) | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| On-chain evidence | 134 FISCO BCOS transactions with receipts; all 134 re-verified on all four nodes; a fresh-network replay reproduced 18/18 scenarios and 134/134 transaction effects; 7 off-chain blocks recorded with their audit entries and no hash. Browse it in the owner console under Evidence | [docs/EXECUTION_EVIDENCE.md](docs/EXECUTION_EVIDENCE.md) |
| Attack Lab | 11 of 11 attacks blocked; A2, A3, A6, A7, A8, A9, and A10 also refused when sent straight to the contract | [docs/ATTACK_LAB_EVIDENCE.md](docs/ATTACK_LAB_EVIDENCE.md) |

All evaluation numbers use the deterministic offline parser (mock adapter), so they measure the code that verifies, enforces, and routes proposals, not a language model's understanding. No language model has been evaluated yet: no provider key is configured. The held-out scenarios were written from the documentation by the same assistant session that built the code, so they are not fully independent; see the report's Run history and scope sections.

## Setup

Prerequisites: Node.js 20+, pnpm 10, [Foundry](https://getfoundry.sh), `jq`, `curl`, `perl`, `openssl`, `xxd`, and a Java runtime (used by the FISCO BCOS console). The first run downloads the FISCO BCOS v3.16.4 node binary and console v3.8.0 from their official GitHub releases.

```bash
pnpm run setup && pnpm demo
```

`pnpm run setup` installs dependencies; creates a git-ignored `.env` with fresh test-only identities if none exists (keys are never printed); builds the contracts; starts the four-node FISCO BCOS network; and deploys and seeds the contracts if the recorded deployment has no code on this chain. `pnpm bootstrap` is an alias.

Use `pnpm run setup`, not `pnpm setup`: `setup` is a built-in pnpm command (it adds `PNPM_HOME` to your shell profile) and always takes precedence over a package script with the same name.

`pnpm demo` starts Risk Intel (8788), the agent API (8787), and the owner console (5173); Ctrl-C stops all three. `AGENT_PORT`, `RISK_INTEL_PORT`, and `WEB_PORT` move them. For development, the services also run individually: `pnpm risk-intel:dev`, `pnpm --filter agent dev`, `pnpm --filter web dev`.

## 60-second demo

Open http://127.0.0.1:5173.

1. **Chat** `Pay ana 50 USD`: firewall, policy pre-check, simulation, risk score, tier T1, executed. The transaction hash and block appear in the pipeline view and the audit log.
2. **Chat** `Pay ana 250 USD`: 250 is at or above the 200 approval line, so it becomes a T2 pending approval. In the **Control Center** its card shows the operation, amount, recipient, agent reasoning, risk score, triggered rules, and expiry; Approve runs the owner's `approve()` and Reject its `reject()`, and success appears only after the chain confirms.
3. **Chat** `Pay ana`: the agent asks "How much USD or CNY should I pay contact ana?" instead of guessing.
4. **Attack Lab**, Run all 11: prompt injection, over-limit, split payments, unknown recipient, cooldown swap, approval replay, expired approval, agent resume, raw contract bypass, policy change, and owner impersonation, each with the layer that stopped it and its transaction hash or revert.
5. **Kill switch** (Control Center): pause, watch a payment be refused with `PAUSED`, resume (owner only).
6. **Evidence Inspector**: executed transactions, on-chain refusals, and off-chain blocks from the FISCO BCOS evidence, each transaction verifiable against the node.
7. **Evaluation**: the evaluation targets and live counts from the audit log.

The console's left sidebar has Home (balances, approvals waiting, kill switch status, quick actions), AI Agent (example prompts; every result starts with one plain sentence, details and proof fold below), Wallet (demo balances and recent activity), Control Center (limits, allowlist, cooldown, pending approvals, kill switch), Attack Lab, Evidence Inspector, and Evaluation. The top bar shows the chain backend, chain ID, and block height read from the node, the owner role, and the kill switch, which asks for confirmation before pausing; while paused, every page shows a banner with Resume. Statuses read in plain words ("Done", "Needs your approval", "Blocked") with the exact backend value beside them in a small mono tag, and technical terms carry an (i) explanation. Fonts are self-hosted, so the console works offline. Screenshots of every page at 1920×1080 are in [docs/screenshots/](docs/screenshots/); `E2E_CONSOLE_URL=http://localhost:3000 pnpm --filter web exec playwright test console-pages` reruns the main flows on the running demo and retakes them.

## Currencies

Demo units come from [`config/currencies.json`](config/currencies.json): ISO 4217 code, decimals, display name, and the seed amount minted at setup. The default is USD and CNY. `DemoLedger` stores balances by currency code and lists units through the owner-only `addCurrency`; deployment, the agent, the parser, the web console, and the evaluation all read the same file, so adding an entry adds a currency without code changes (proven by `test_thirdCurrencyWorksWithoutCodeChanges` and `agent/src/exec/currency.e2e.test.ts`, which pays in SGD). Service fees are always USD. Policy limits are compared in minor units of the payment's currency, with no FX conversion.

## Deployment

Everything runs locally. There is no hosted deployment and no connection to any external chain.

| Target | Commands | Manifest |
|---|---|---|
| Local FISCO BCOS, four nodes, chain ID 1337 (primary) | `./scripts/chain-up.sh`, `./scripts/deploy-fisco.sh`, `./scripts/seed.sh` | `deployments/fisco.json` |
| Local Anvil, chain ID 31337 (development fallback) | `./scripts/dev-up.sh` | `deployments/local.json` |
| Stop FISCO BCOS | `./scripts/chain-down.sh` | |

`CHAIN_BACKEND` (`fisco` or `evm-local`) selects the backend; startup rejects any RPC endpoint that is not loopback and any chain ID outside the backend's local mapping. A production web build fails if the local demo owner key variable is set; deployed pages must sign owner actions with an injected browser wallet.

If agent requests hang after the network has been idle for a long time, the FISCO BCOS nodes may have stopped committing blocks: `./scripts/chain-down.sh && ./scripts/chain-up.sh` restarts them with their data intact. See the operational risk in [docs/SECURITY_SELF_ASSESSMENT.md](docs/SECURITY_SELF_ASSESSMENT.md).

## Tests and evidence

```bash
pnpm test                           # forbidden-content check, chain config check, every package's tests
pnpm lint
pnpm typecheck
pnpm --filter web test:e2e          # Playwright owner-console tests
cd contracts && forge test -vv      # unit, fuzz, and invariant tests I1–I8
pnpm --filter agent test:parity     # agent pre-check vs contract on both backends (needs FISCO running)
pnpm eval                           # all 62 scenarios (42 original + 20 held-out); writes eval/results.json and docs/EVAL_REPORT.md
pnpm eval --suite=heldout "--record=label"  # one suite, recorded as a labelled row in eval/history.json
pnpm eval N01 X03                   # selected scenarios; --llm=configured uses the configured LLM provider
pnpm attacks                        # 11 Attack Lab scenarios; `pnpm attacks A2 A9` or `--api` for the running agent
pnpm evidence                       # on-chain execution evidence on FISCO BCOS; exports evidence/
pnpm verify-evidence --running      # mode (a): re-fetch every exported hash from all four nodes
pnpm verify-evidence --fresh        # mode (b): new four-node network, deploy, replay, compare
pnpm licenses:doc                   # regenerate docs/LICENSES.md from the installed dependency tree
```

## Project structure

```text
contracts/   Solidity: GuardianWallet (policy controller) and DemoLedger (simulated ledger); Foundry tests
agent/       TypeScript service: LLM adapters, firewall, policy pre-check, simulation, risk score,
             tier gate, restricted signers (src/exec/), planner, scheduler, audit chain, Attack Lab, HTTP API
risk-intel/  Synthetic payee checks and a cached USD/CNY FX snapshot, released after a verified fee receipt
web/         Owner console: AI Agent, Wallet, Control Center, Attack Lab, Evidence Inspector, Evaluation
eval/        Evaluation scenarios (eval/scenarios/*.yaml) and harness
evidence/    Exported FISCO BCOS receipts, evidence.json, and a node data snapshot
scripts/     Setup, demo, chain, deployment, evidence, and repository checks
docs/        Technical design, security self-assessment, threat model, reports, licenses
```

Design: [SPEC.md](SPEC.md) and [docs/TECHNICAL.md](docs/TECHNICAL.md). Security: [docs/SECURITY_SELF_ASSESSMENT.md](docs/SECURITY_SELF_ASSESSMENT.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Licenses: [docs/LICENSES.md](docs/LICENSES.md).

## Compliance note

- Research prototype. Simulated ledger with USD and CNY demo balances only; demo units have no value and there is no real money.
- CNY balances: Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.
- Runs only on a permissioned chain operated by the team (local FISCO BCOS) or a local development chain (Anvil). The code never connects to an external chain or RPC endpoint, and startup rejects non-loopback endpoints.
- FX is a read-only cached snapshot shown for reference; no amount is computed from it.
- All contacts, payees, and risk results are synthetic.
- Signing keys exist only in the git-ignored `.env`; `.env.example` holds placeholders. The agent signing key is read only under `agent/src/exec/`, and a test enforces this.
- Whether the organizers accept transaction hashes from a team-operated permissioned chain as evidence has not yet been confirmed. `pnpm verify-evidence --fresh` lets anyone reproduce the results on a fresh network of their own.

## License

MIT. Third-party licenses: [docs/LICENSES.md](docs/LICENSES.md).
