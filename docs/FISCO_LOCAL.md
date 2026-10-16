# Local FISCO BCOS runtime

This research prototype uses a four-node local FISCO BCOS v3.16.4 Air network as its primary permissioned chain operated by the team. It carries only USD and BDT demo balances and no real money.

## Compatibility decision

- Node: FISCO BCOS v3.16.4, the current stable v3 release selected for this setup.
- Contract compiler: Solidity 0.8.24. The node exposes the Cancun EVM feature and the official console supports Solidity through 0.8.26, so no pragma change was required.
- Application connection: Ethereum-compatible Web3 JSON-RPC on loopback ports 8545–8548. The primary endpoint is port 8545, and viem is reused.
- Administrative bootstrap: official FISCO BCOS console v3.8.0 backed by the official Java SDK. It enables the documented Web3 balance features and initializes only the local owner and agent identities.

Official references:

- [Web3 interface setup and supported methods](https://fisco-bcos-doc.readthedocs.io/zh-cn/latest/docs/develop/web3_usage.html)
- [Node and Web3 endpoint configuration](https://fisco-bcos-doc.readthedocs.io/zh-cn/latest/docs/tutorial/air/config.html)
- [Official console commands](https://fisco-bcos-doc.readthedocs.io/zh-cn/latest/docs/operation_and_maintenance/console/console_commands.html)
- [FISCO BCOS v3.16.4 release](https://github.com/FISCO-BCOS/FISCO-BCOS/releases/tag/v3.16.4)
- [Official console v3.8.0 release](https://github.com/FISCO-BCOS/console/releases/tag/v3.8.0)

## Exact setup and acceptance commands

The chain builder invocation used by `chain-up.sh` was:

```bash
bash .fisco/build_chain.sh -l 127.0.0.1:4 -p 30300,20200 \
  -o .fisco/nodes.building -v v3.16.4 -I 1337 -a "$owner_address"
```

The repeatable project commands are:

```bash
./scripts/chain-up.sh
./scripts/deploy-fisco.sh
./scripts/seed.sh
pnpm --filter agent exec tsx src/exec/fiscoT1.ts
./scripts/chain-down.sh
```

`chain-up.sh` first uses the official native Apple Silicon release. If native setup fails, it retries the same official builder in Docker mode. Generated node state, certificates, downloaded tools, and logs stay under the ignored `.fisco/` directory.

## Acceptance receipt

The T1 action paid 25 USD demo units to the first synthetic contact.

- Transaction hash: `0x54267d1854d69bda2d83eba11167900920ff65631f4721ac383512a96a705705`
- Status: success (`0x1`)
- Block: 18 (`0x12`)
- Gas used: 115949 (`0x1c4ed`)
- Agent: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- GuardianWallet: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- Intent ID: `0x6c99a12ccfbfebd0eae4f388322778e119dfcd60beb5eb216ad65755e70f8497`

The receipt was read directly from the local FISCO node with:

```bash
curl -fsS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0x54267d1854d69bda2d83eba11167900920ff65631f4721ac383512a96a705705"],"id":1}' \
  http://127.0.0.1:8545 | jq .
```

No unresolved acceptance blocker remains. During validation the native nodes stopped advancing after a long idle period; restarting the four local processes restored PBFT progress without data loss, after which the T1 receipt finalized successfully.
