# Blockers

Open problems that could not be resolved within the time limit, with the exact errors (CLAUDE.md hard rule 8). Research prototype: USD and CNY demo balances on a simulated ledger, no real money.

## Fresh clone: `pnpm run setup` can fail on a brand-new local FISCO BCOS network (2026-10-20)

Found during the final check: a fresh clone of the repository at `e17ccb7`, no `.env`, macOS (Apple silicon), FISCO BCOS v3.16.4, followed the README from zero.

**Symptom.** `pnpm run setup` stops in the deploy step:

```text
Error: Failed to send transaction after 4 attempts Err(server returned an error response: error code -32602: InsufficientFunds)
```

The chain stays at block 0, and the owner and agent execution balances are 0, although the FISCO BCOS console reported the balance commands as successful.

**Observed twice.**

1. First fresh run. The console printed `"code":-4006, "msg":"the session has been disconnected"` for `setSystemConfigByKey feature_balance_precompiled 1`, then `"code":16, "msg":"Call address error."` for both `addBalance` calls, then the InsufficientFunds error above. Running `pnpm run setup` again on the same network succeeded (`Setup complete`).
2. Second fresh run (nodes deleted and rebuilt). Both `addBalance` calls reported success, but no block was ever committed. Node logs show PBFT view changes without a commit, and node0 logs `[BLOCK SYNC][updatePeerStatus]Receive invalid status packet with different genesis hash` for all three peers, although the four `config.genesis` files are byte-identical. Restarting the nodes (`stop_all.sh`, then `./scripts/chain-up.sh`) did not recover it.

**Not affected.** The same scripts deployed successfully in the existing development checkout, in the hosted demo container on Linux (seven container starts on the Azure VM), and on the second run in case 1.

**Workaround for reviewers.** Run `pnpm run setup` again. If the chain still reports block 0 (`cast block-number --rpc-url http://127.0.0.1:8545`), rebuild the local network: `./scripts/chain-down.sh`, make sure no `fisco-bcos` process from this folder is still running, delete `.fisco/nodes`, and run `pnpm run setup`.

**Next step.** Make `scripts/chain-up.sh` confirm that a new network commits a block (for example, a funding transaction whose balance is then read back) before setup deploys, and rebuild the network once when it does not. This was not done here because the cause (node0 reporting a different genesis hash from identical files) was not identified within the time limit.
