# Executor

This is the only directory permitted to read `AGENT_PRIVATE_KEY`. `AgentExecutor` verifies that the
key matches the deployed agent and accepts only actions whose policy verdict and simulation agree.
Blocked or mismatched authorizations are rejected before any RPC submission.
