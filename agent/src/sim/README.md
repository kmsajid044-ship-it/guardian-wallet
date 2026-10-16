# Simulation

`simulateAgentAction` uses viem `simulateContract` from the configured agent address and normalizes
the contract's enum return to `EXECUTED`, `PENDING`, or `BLOCKED`, plus pending id/share output.
