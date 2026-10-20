# Guardian Wallet

**Guardian Wallet: a trust and control layer for autonomous AI finance. Let AI handle your financial tasks, without giving up control of your money.**

All balances are simulated demo units on a permissioned chain operated by the team; no real money or customer funds are involved.

A research prototype for the 2026 Shenzhen FinTechathon, International Track, Topic F: an AI agent that pays, saves, and plans on its owner's behalf, inside limits the agent cannot change.

**The LLM proposes. Code verifies. The contract enforces. The human decides above the line.**

- The agent turns a chat request into a structured proposal, with a real LLM (Groq, optional) or offline rules; a grounding check rejects any amount, currency, or contact the request does not actually contain. It works with contact IDs, never raw addresses, and its key can call only four contract functions: `pay`, `requestApproval`, `saveToSavings`, `payServiceFee`.
- Deterministic code checks every proposal before signing: an injection firewall, a mirror of the contract policy, a local simulation, an explained risk score, and a permission tier (T0–T3).
- The `GuardianWallet` contract enforces the same policy again on-chain, so even a fully compromised agent key cannot exceed a limit, pay an unknown recipient, resume a paused wallet, or change its own policy.
- Payments of 200 USD or more wait for the owner. The owner or guardian can pause everything at any time; only the owner can resume.

It runs on a four-node local FISCO BCOS network, a permissioned chain operated by the team, with USD and CNY demo balances on a simulated ledger. There is no real money.

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

## Online demo

**https://104-208-100-228.sslip.io**: the full owner console, with nothing to install.

- A four-node FISCO BCOS network (v3.16.4, chain ID 1337) runs in one container on an Azure VM operated by the team (Standard_B2als_v2, East Asia), together with the agent API, Risk Intel, and the console. Every chain endpoint stays inside the container; only HTTPS is public.
- Fresh chain on every restart. "Reset demo" deploys fresh contracts and synthetic seed data on the running chain, and the demo resets itself after 30 minutes without changes.
- Every visitor acts as the demo owner, so Approve, Pause, and Resume work. The owner and agent keys are generated inside the container at start and never leave it.
- Proposals come from Ministral 8B via the Mistral API (`LLM_PROVIDER=mistral`, `MISTRAL_MODEL=ministral-8b-2512`; Groq refuses requests from the VM's region). The demo falls back to the offline rules whenever the model is unavailable: when the free quota is used up, the hourly call cap is reached, or the provider refuses or fails. The AI label in the console names the model only after a call has succeeded and says "offline rules" otherwise. The grounding check still applies online: an amount written in words ("fifty dollars") is answered with a request for digits, never guessed; "send ana $50 for groceries pls" was proposed by the model and paid on chain (2026-10-20).
- Chat is limited to 20 requests per minute per address; model calls, when a provider is configured, are capped per hour.
- The recorded execution evidence (134 transactions, verified on all four nodes) comes from the team's own network and is in this repository, not on the online chain.
- Research prototype: USD and CNY demo balances on a simulated ledger, no real money. Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

Checked on 2026-10-20 with `web/tests-hosted/online-demo.spec.ts` against the live URL: pay $50 and verify the FISCO BCOS receipt, $250 approved by the owner, $600 blocked, pause and resume, all Attack Lab attacks blocked, and Reset demo (7 of 7 passed). The container is built from `Dockerfile` and `hosted/` on the `hosted-demo` branch.

## Results

| What | Result | Source |
|---|---|---|
| Evaluation, 62 scenarios on FISCO BCOS (42 original + 20 held-out) | Task success 100% (62/62), unsafe action rate 0% (0/62), attack block rate 100% (29/29), clarification accuracy 100% (15/15) | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| Held-out scenarios (20, written from the docs only) | Before fixes: task success 80% (16/20), unsafe 0% (0/20), attacks blocked 77.8% (7/9), clarification 100% (6/6); failures H01, H10, H14, H15. After general fixes: all 20 pass within the 62-scenario run | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) (Run history) |
| Agent latency | 219 ms average, 624 ms p95 over 60 agent requests, including on-chain confirmation | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| Estimated owner time saved | 47.9 min over 13 owner tasks, 3.68 min per task (an estimate against stated manual baselines) | [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) |
| On-chain evidence | 134 FISCO BCOS transactions with receipts; all 134 re-verified on all four nodes; a fresh-network replay reproduced 18/18 scenarios and 134/134 transaction effects; 7 off-chain blocks recorded with their audit entries and no hash. Browse it in the owner console under Evidence | [docs/EXECUTION_EVIDENCE.md](docs/EXECUTION_EVIDENCE.md) |
| Real language model (Groq, `openai/gpt-oss-120b`), same 62 scenarios on FISCO BCOS | Run 1: task success 82.3% (51/62), unsafe 11.3% (7/62). After a general grounding check, run 2: task success 100% (62/62), unsafe 0% (0/62), attacks blocked 100% (29/29), clarification 100% (15/15), 10 of 60 agent steps fell back to the offline rules, 4732 ms average latency (with 4 s pacing for the free tier). The check was designed after run 1 and validated on the same scenarios; the independent check, held-out 2 (10 new scenarios written afterwards from SPEC.md and README only): task success 90% (9/10), unsafe 0%, attacks 3/3, clarification 3/3, fallbacks 2 of 10 steps; K04 ("200 dollars") got a question instead of an approval | [docs/LLM_EVIDENCE.md](docs/LLM_EVIDENCE.md) |
| Attack Lab | 11 of 11 attacks blocked; A2, A3, A6, A7, A8, A9, and A10 also refused when sent straight to the contract | [docs/ATTACK_LAB_EVIDENCE.md](docs/ATTACK_LAB_EVIDENCE.md) |

The first evaluation rows use the deterministic offline parser (mock adapter), so they measure the code that verifies, enforces, and routes proposals, not a language model's understanding. The Groq rows run the same scenarios with a real model proposing; the scenarios and prompts were not changed for it. The held-out scenarios were written from the documentation by the same assistant session that built the code, so they are not fully independent; see the report's Run history and scope sections.

## Setup

Prerequisites: Node.js 20+, pnpm 10, [Foundry](https://getfoundry.sh), `jq`, `curl`, `perl`, `openssl`, `xxd`, and a Java runtime (used by the FISCO BCOS console). The first run downloads the FISCO BCOS v3.16.4 node binary and console v3.8.0 from their official GitHub releases.

```bash
pnpm run setup && pnpm demo
```

`pnpm run setup` installs dependencies; creates a git-ignored `.env` with fresh test-only identities if none exists (keys are never printed); builds the contracts; starts the four-node FISCO BCOS network; and deploys and seeds the contracts if the recorded deployment has no code on this chain. `pnpm bootstrap` is an alias.

Use `pnpm run setup`, not `pnpm setup`: `setup` is a built-in pnpm command (it adds `PNPM_HOME` to your shell profile) and always takes precedence over a package script with the same name.

`pnpm demo` starts Risk Intel (8788), the agent API (8787), and the owner console (5173); Ctrl-C stops all three. `AGENT_PORT`, `RISK_INTEL_PORT`, and `WEB_PORT` move them. For development, the services also run individually: `pnpm risk-intel:dev`, `pnpm --filter agent dev`, `pnpm --filter web dev`.

For a clean demo (for example before recording the video), one command resets everything:

```bash
./scripts/demo-reset.sh
```

It stops a running demo, restarts the four FISCO BCOS nodes (ledger data kept), deploys fresh contracts, seeds the synthetic demo balances and contacts, moves the previous audit log aside to `.demo/`, and starts the demo with the owner console on http://localhost:3000 (`WEB_PORT` changes the port). The AI provider follows `.env`. The video narration with exact clicks is [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Real AI (optional)

Without a key the app runs fully on offline rules (the deterministic parser), and the top bar shows "AI: offline rules". To let a real LLM read requests, with your own free Groq key:

1. Create a free key at https://console.groq.com/keys and put it in `.env` (git-ignored): `GROQ_API_KEY=<your key>` and `LLM_PROVIDER=groq`.
2. Restart `pnpm demo`. The top bar now shows "AI: GPT-OSS 120B via Groq".

The model only proposes. Its JSON is validated with zod, and every proposal still passes the firewall, policy pre-check, simulation, risk score, tier gate, and the contract. Invalid output is retried once and a rate limit (429) up to three times with backoff; after that the request falls back to the offline rules and is marked "fallback", so a payment flow never fails because the LLM is down. Groq no longer serves Llama 3.3 70B, so the default is `openai/gpt-oss-120b`; `GROQ_MODEL` picks another. Gemini works the same way with `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`. Keys are read only from `.env` and are never logged. Raw model output from the evaluation runs: [docs/LLM_EVIDENCE.md](docs/LLM_EVIDENCE.md).

## 60-second demo

Open http://127.0.0.1:5173 (a short three-step tour runs on the first visit).

1. **Home**, tap `Pay Ana $50`: firewall, policy pre-check, simulation, risk score, executed. The receipt says "Paid $50.00 to Ana"; **View proof** shows the transaction and Verify asks the node for its receipt.
2. **Home**, tap `Pay Ana $250`: 250 is above the 200 approval line, so the receipt says "Needs your OK: $250.00 to Ana. It's above your $200 limit." with Approve and Decline right there (also in "Waiting for your OK"). Approve runs the owner's `approve()`, Decline its `reject()`; success appears only after the chain confirms.
3. **Home**, type `Send Ana $600`: "Blocked: $600.00 is above your $500 limit.", refused by the contract with a recorded hash.
4. **Home**, type `Pay someone`: the AI asks "Who should I pay?" with the contacts as chips instead of guessing.
5. **Pause AI** (Home or Controls): asks first, then every page shows "Paused. The AI can't pay anyone." until the owner resumes.
6. **Security**: the Attack Lab (Run all 11: injection, over-limit, split payments, unknown recipient, cooldown swap, approval replay, expired approval, agent resume, raw contract bypass, policy change, owner impersonation), the Evidence Inspector (executed transactions, on-chain refusals, and off-chain blocks, each verifiable against the node), and Evaluation.

The console has four tabs: **Home** (demo money, one "What should your AI do?" box with example chips, the answer as a receipt, anything waiting for your OK, and one Pause button), **Activity** (everything the AI did, filterable, each row expandable to its proof and Why-this-action panel), **Controls** (limits, recipients, pause and resume), and **Security** (Attack Lab, Evidence Inspector, Evaluation, for reviewers). Amounts read like $4,189.90 and ¥34,400.00, statuses read "Done", "Needs your OK", "Blocked", "Asking you", or "Paused", and raw codes stay out of the normal view. The **Technical details** switch in the top bar (remembered per browser) shows the backend codes, permission tiers, risk factors, hashes, and the Why-this-action panel inline on every card. The top bar also shows the chain backend, chain ID, and block height read from the node, the Reduce effects switch, light and dark mode, and a menu with "Show tour again". Cards use a frosted-glass look with a 3D shield on Home and a cube on Attack Lab; "Reduce effects" (on automatically when the system asks for reduced motion) restores the solid design. Fonts are self-hosted, so it works offline. Effects-on screenshots of every page in dark and light, frame-rate samples, and a short video are in [docs/screenshots/glass/](docs/screenshots/glass/), retaken by `E2E_GLASS_URL=http://localhost:3000 pnpm --filter web exec playwright test glass-walkthrough`; `E2E_CONSOLE_URL=http://localhost:3000 pnpm --filter web exec playwright test console-pages` reruns the same flows headless.

## Currencies

Demo units come from [`config/currencies.json`](config/currencies.json): ISO 4217 code, decimals, display name, and the seed amount minted at setup. The default is USD and CNY. `DemoLedger` stores balances by currency code and lists units through the owner-only `addCurrency`; deployment, the agent, the parser, the web console, and the evaluation all read the same file, so adding an entry adds a currency without code changes (proven by `test_thirdCurrencyWorksWithoutCodeChanges` and `agent/src/exec/currency.e2e.test.ts`, which pays in SGD). Service fees are always USD. Policy limits are compared in minor units of the payment's currency, with no FX conversion.

## Deployment

Everything runs locally. There is no hosted deployment and no connection to any external chain.

| Target | Commands | Manifest |
|---|---|---|
| Local FISCO BCOS, four nodes, chain ID 1337 (primary) | `./scripts/chain-up.sh`, `./scripts/deploy-fisco.sh`, `./scripts/seed.sh` | `deployments/fisco.json` |
| Local Anvil, chain ID 31337 (development fallback) | `./scripts/dev-up.sh` | `deployments/local.json` |
| Clean demo state on FISCO BCOS (fresh deploy and seed, console on port 3000) | `./scripts/demo-reset.sh` | `deployments/fisco.json` |
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
pnpm eval --suite=heldout2                  # the 10 held-out-2 scenarios (K01–K10), run on their own
LLM_PROVIDER=groq pnpm eval --llm=configured --pace=4000  # real AI; raw output to eval/llm-runs/<run-id>/
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
web/         Owner console: Home, Activity, Controls, Security (Attack Lab, Evidence Inspector, Evaluation)
eval/        Evaluation scenarios (eval/scenarios/*.yaml) and harness
evidence/    Exported FISCO BCOS receipts, evidence.json, and a node data snapshot
scripts/     Setup, demo, chain, deployment, evidence, and repository checks
docs/        Technical design, security self-assessment, threat model, reports, licenses
```

Design: [SPEC.md](SPEC.md) and [docs/TECHNICAL.md](docs/TECHNICAL.md) (including Working / Partial / Planned). Limits: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). Submission: [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md). Demo video: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Security: [docs/SECURITY_SELF_ASSESSMENT.md](docs/SECURITY_SELF_ASSESSMENT.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Licenses: [docs/LICENSES.md](docs/LICENSES.md).

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
