# Policy pre-check

`precheckAction` mirrors the exact check order of all four `GuardianWallet` agent functions and
returns `EXECUTE`, `NEEDS_APPROVAL`, or `BLOCKED` with the contract reason name. `GuardianReader`
supplies live simulated-ledger state; Anvil parity tests compare predictions with simulation and recorded events.
