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
