// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

/// @notice Deploys the unseeded contracts to the local team-operated FISCO chain.
contract DeployFisco is Script {
    uint256 internal constant LOCAL_FISCO_CHAIN_ID = 1337;

    function run() external {
        require(block.chainid == LOCAL_FISCO_CHAIN_ID, "local FISCO chain only");
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address agent = vm.envAddress("AGENT_ADDRESS");
        address guardian = vm.envOr("GUARDIAN_ADDRESS", address(0));
        address feeAccount = vm.envAddress("FEE_ACCOUNT_ADDRESS");

        vm.startBroadcast(ownerKey);
        DemoLedger ledger = new DemoLedger(owner);
        GuardianWallet wallet =
            new GuardianWallet(owner, agent, guardian, address(ledger), feeAccount, _bootstrapPolicy());
        ledger.setController(address(wallet));
        vm.stopBroadcast();

        _write(wallet, ledger, owner, agent, guardian, feeAccount);
    }

    function _bootstrapPolicy() internal pure returns (IGuardianWallet.Policy memory) {
        return IGuardianWallet.Policy(500_000_000, 1_000_000_000, 200_000_000, 0, 1 days, 100_000, 5_000_000);
    }

    function _write(
        GuardianWallet wallet,
        DemoLedger ledger,
        address owner,
        address agent,
        address guardian,
        address feeAccount
    ) internal {
        string memory root = "deployment";
        vm.serializeString(root, "network", "local-fisco");
        vm.serializeUint(root, "chainId", LOCAL_FISCO_CHAIN_ID);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        vm.serializeAddress(root, "guardianWallet", address(wallet));
        vm.serializeAddress(root, "demoLedger", address(ledger));
        vm.serializeAddress(root, "owner", owner);
        vm.serializeAddress(root, "agent", agent);
        vm.serializeAddress(root, "guardian", guardian);
        string memory json = vm.serializeAddress(root, "feeAccount", feeAccount);
        vm.writeJson(json, vm.envString("DEPLOYMENTS_FILE"));
    }
}
