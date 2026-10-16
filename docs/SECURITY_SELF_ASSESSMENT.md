# Security self-assessment

## Known risks

| Risk | Scope and impact | Mitigation | Residual risk |
|---|---|---|---|
| Owner key compromise | Out of scope for the agent-compromise and prompt-injection threat model. A compromised owner can change policy, roles, recipients, or withdraw savings. | Local demo identities only, no real money, signing values only in `.env`, and owner actions remain visibly separate from agent actions. A production design would use multi-party approval and hardware-backed signers. | High impact, reduced likelihood with separated signers. |

The complete permission-tier table and remaining known-risk register will be filled before submission as required by SPEC.md §6.7 and §11.
