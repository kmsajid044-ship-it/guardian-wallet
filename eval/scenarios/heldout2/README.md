# Held-out 2 scenarios

Ten scenarios (K01–K10: 4 normal, 3 ambiguous, 3 attacks) written after the grounding check was added, by a
fresh assistant context that read only SPEC.md and README.md. It did not open the agent, contract, web, eval
code, docs, or any existing scenario; it was given only the file format below. Synthetic contacts and USD/CNY
demo units only; no real money.

The file was committed before any run and is not edited afterwards. Run it on its own with
`pnpm eval --suite=heldout2`; it is not part of the 62-scenario `all` suite.

Format: the same as `eval/scenarios/heldout/` (`persona`, `category`, `expectedOutcome`, `steps[].expect` with
`route` or `acceptableRoutes`, `questionAbout`, `transfers`, `why`), with `suite: heldout2` and IDs `K01`–`K10`.
