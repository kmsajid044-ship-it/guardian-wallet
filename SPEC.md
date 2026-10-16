# Guardian Wallet — Technical Specification

## 1. Purpose

Guardian Wallet is a Topic F research prototype using a simulated ledger and no real money. It runs on local FISCO BCOS as the primary permissioned chain operated by the team, with local Anvil for development and fallback testing.

Core principle: **The LLM proposes. Code verifies. The contract enforces. The human decides above the line.**

## 2. Demonstrated capabilities

| Capability | Evidence |
|---|---|
| Intent understanding | Structured proposals and targeted clarification |
| Task planning | Editable ordered plans that stop after failure |
| Safe execution | Firewall, policy mirror, simulation, risk score, contract policy |
| User control | Pending approvals, expiry, pause controls, owner configuration |
| Measurable value | Spending limits, savings view, operating-fee accounting |

## 3. Simulated money model

`DemoLedger` stores per-account minor-unit balances for two currencies: USD and BDT. Only its owner may mint demo units. Only `GuardianWallet`, configured as controller, may move balances. There is no arbitrary account-to-account transfer entry point.

Savings is a sub-account in `DemoLedger`. Each account and currency has a principal and checkpoint time. The read path computes fixed-rate simple interest:

`balance = principal + principal × rateBps × elapsed / (10,000 × 365 days)`

The owner may return savings to the available wallet balance. This remains simulated accounting.

## 4. Roles and agent surface

- Owner: policy, recipients, agent rotation, fee account, approvals, savings withdrawal, pause and resume.
- Agent: exactly four value-related entry points: `pay`, `requestApproval`, `saveToSavings`, `payServiceFee`.
- Guardian: pause only.

The agent has no generic call surface.

## 5. Policy

The policy contains per-transfer limit, daily limit, approval threshold, recipient cooldown, pending expiry, fee-per-call limit, and daily operating-fee limit. Day buckets use `block.timestamp / 1 days`.

`pay` handles amounts below the approval threshold. `requestApproval` handles amounts from the threshold through the per-transfer limit and creates a pending record. Pending actions execute once only, by the owner, before expiry. Recipient removal or insufficient available balance prevents approval.

Every policy violation emits `PolicyViolation` and returns `BLOCKED`. Unauthorized role calls revert.

Service fees are USD demo units booked to the configured fee account. Their daily counter is independent from ordinary payments.

## 6. Invariants

- I1: autonomous daily payment outflow stays within the daily limit.
- I2: payments reach only active allowlisted recipients.
- I3: agent actions move no value while paused.
- I4: pending actions execute at most once and never after expiry.
- I5: savings remains assigned to the wallet account.
- I6: only the owner changes policy and role configuration.
- I7: the agent cannot escape its four-function surface.
- I8: service fees remain within their separate daily budget and use USD only.

## 7. Agent pipeline

Every direct, planned, and scheduled action runs through:

`intent proposal → firewall → policy pre-check → contract simulation → risk score → route → restricted signer → audit`

The LLM receives contact IDs, never raw recipient addresses. Untrusted text is delimited as data. The signer alone reads the agent signing value. Explanations use structured results only.

Provider output is validated by the strict `ActionProposal` schema. When the selected provider is unavailable or has no configured key, the deterministic parser supplies the same schema so the offline demonstration remains complete. Missing or ambiguous amount, contact, or currency produces a targeted clarification instead of an inferred value.

The firewall scans chat text, memos, payee names, and fetched content for instruction injection, raw-address or recipient substitution, and attempts to alter policy. Risk scoring is an explained 0–100 sum covering amount history, first payment to a contact, time of day, recent payment velocity, injection signals, daily-limit concentration, and synthetic payee results. Scores from 60 through 84 require T2 owner approval; scores from 85 are blocked.

Plans are shown before execution, remain editable while drafts, and stop at the first blocked or approval-requiring step. Each recurring occurrence re-enters the same firewall, policy, simulation, risk, tier, signing, and audit sequence.

Every pipeline decision records its outcome, reason, tier, risk factors, transaction hash, and block number when present. Audit entries form an append-only SHA-256 chain verified by `verifyAuditChain()`.

Before a first or approval-sized payment, the agent books a fixed service fee through `payServiceFee`, obtains a synthetic payee check, and adds the result to risk scoring. FX is a read-only cached USD/BDT snapshot.

## 8. Permission tiers

| Tier | Meaning | Examples |
|---|---|---|
| T0 | No value movement | Queries, blocked actions, pause |
| T1 | Autonomous within policy | Small payment, savings funding, service fee |
| T2 | Human approval required | Approval-sized payment |
| T3 | Owner configuration | Policy, recipients, roles, fee account, resume |

## 9. Attack scenarios

The test and evaluation suites cover instruction injection, raw-address injection, repeated small payments, newly added recipients, compromised agent identity, pause enforcement, pending replay, owner-surface probing, and excessive service fees. Unsafe action rate target: zero.

## 10. Repository layout

```text
contracts/   Solidity policy and simulated ledger
agent/       TypeScript service and restricted executor
risk-intel/  Synthetic risk and cached FX service
web/         Local user interface
eval/        Scenario evaluation
scripts/     Local development and repository checks
docs/        Security, testing, and architecture evidence
```

The web owner console provides agent chat with visible pipeline steps and clarification, a T2 approval inbox, T3 policy and allowlist settings, pause/resume controls, USD and BDT balance cards, a labelled cached FX reference, and a live receipt-verifiable audit table. Light and dark themes use bundled system fonts and large-format presentation sizing. Attack Lab and Value Dashboard routes are reserved for their dedicated builds.

## 11. Chain runtime

The primary runtime is a four-node local FISCO BCOS v3.16.4 Air network with PBFT and numeric chain ID 1337. Each node exposes a loopback-only Web3 JSON-RPC endpoint; the primary endpoint is `http://127.0.0.1:8545`. The application reuses viem for reads, simulation, and restricted signing. The official Java SDK console is used only to initialize local Web3 execution balances.

The agent selects `fisco` (default) or `evm-local` through `CHAIN_BACKEND`. Both implementations use the restricted `ChainAdapter`; startup and build reject endpoints outside loopback and chain IDs outside the backend's fixed local mapping.

Contracts remain on Solidity 0.8.24. FISCO BCOS v3.16.4 includes the Cancun EVM feature and the official console supports Solidity through 0.8.26, so the same build artifacts run on FISCO BCOS and the local development fallback.
