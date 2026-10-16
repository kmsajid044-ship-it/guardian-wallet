# Mutation Testing

Each mutation was applied temporarily, the named test or invariant was observed failing, and the original implementation was restored. Handler changes ensure mutations are exercised during invariant runs.

| Mutation | Catch | Handler or test fix |
|---|---|---|
| Policy violation reverted instead of returning `BLOCKED` | `test_payAboveThresholdIsBlockedAndDoesNotRevert` | Agent paths call the non-reverting violation helper. |
| Daily accounting skipped before `pay` | I1 and `test_dailyBucketResets` | Handler records actual recipient balance deltas per day. |
| Day bucket failed to reset | `test_dailyBucketResets` | Handler warps across day boundaries. |
| Recipient activation time ignored | `test_recipientCooldown` and I2 | Handler includes an unknown recipient path and cooldown unit coverage remains explicit. |
| Pending status changed after balance movement | `test_requestApprovalCreatesPendingAndOwnerExecutesOnce` and I4 | Handler attempts a second approval for every selected pending action. |
| Expiry comparison removed | `test_pendingCannotExecuteAfterExpiry` and I4 | Handler includes deliberately late approval attempts. |
| Pause check removed from a value path | `test_pauseRolesAndOwnerOnlyUnpause` and I3 | Handler snapshots recipient, fee, and savings balances while paused. |
| Guardian allowed to resume | `test_pauseRolesAndOwnerOnlyUnpause` and I6 | Handler directly probes guardian resume access. |
| Owner modifier removed from configuration | `test_policyOnlyOwner` and I6 | Handler probes fee-account and agent configuration with the agent identity. |
| Agent gained a fifth configuration path | `test_agentCannotCallOwnerFunctions` and I7 | Handler continuously probes owner selectors from the agent identity. |
| Service fee charged against the ordinary daily counter | `test_payServiceFeeUsesSeparateBudget` and I8 | Handler and unit test compare the independent counters. |
| Service fee allowed above its per-call cap | `testFuzz_serviceBudget` and I8 | Handler fuzzes fee amounts through and above the cap. |
| Demo balance moved by a non-controller | `test_balancesMoveOnlyThroughController` | Direct unauthorized ledger movement is attempted explicitly. |
| Mint permission removed | `test_mintOnlyOwner` | A non-owner mint attempt is retained. |
| Savings interest omitted from reads | `test_savingsSimpleInterestComputedOnRead` | Test advances exactly one model year and checks fixed simple interest. |
| USD and CNY storage aliased | `testFuzz_currencyBalancesAreIndependent` | Independent randomized values are minted and compared. |

Latest result: all contract tests pass and invariants I1–I8 pass with 256 runs and 16,384 calls.
