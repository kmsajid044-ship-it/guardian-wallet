# Chain access

`createChainClients` builds public viem clients from validated config and the shared deployment
manifest. `GuardianReader` exposes contract, demo-balance, timestamp, and budget reads required
by policy evaluation. This directory never imports or reads signing secrets.
