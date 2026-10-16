// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script} from "forge-std/Script.sol";
import {CurrencyConfig} from "./CurrencyConfig.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

contract Deploy is CurrencyConfig {
    uint256 internal constant UNIT = 1_000_000;
    function run() external {
        require(block.chainid == 31337, "local development chain only");
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address agent = vm.envAddress("AGENT_ADDRESS");
        address guardian = vm.envOr("GUARDIAN_ADDRESS", address(0));
        address feeAccount = vm.envAddress("FEE_ACCOUNT_ADDRESS");
        DemoCurrency[] memory units = _currencies();
        vm.startBroadcast(ownerKey);
        DemoLedger ledger = new DemoLedger(owner);
        _listCurrencies(ledger, units);
        GuardianWallet wallet = new GuardianWallet(owner, agent, guardian, address(ledger), feeAccount, _policy());
        ledger.setController(address(wallet));
        _seedCurrencies(ledger, address(wallet), units);
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_1_ADDRESS"), true, "Ana - synthetic designer");
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_2_ADDRESS"), true, "Bob - synthetic landlord");
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_3_ADDRESS"), true, "Chen - synthetic supplier");
        vm.stopBroadcast();
        _write(wallet, ledger, owner, agent, guardian, feeAccount);
    }
    function _policy() internal pure returns (IGuardianWallet.Policy memory) { return IGuardianWallet.Policy(500 * UNIT, 1_000 * UNIT, 200 * UNIT, 10 minutes, 1 days, 100_000, 5 * UNIT); }
    function _write(GuardianWallet wallet, DemoLedger ledger, address owner, address agent, address guardian, address feeAccount) internal {
        string memory root = "deployment";
        vm.serializeString(root, "network", "local-anvil");
        vm.serializeUint(root, "chainId", 31337);
        vm.serializeUint(root, "deployedAt", block.timestamp);
        vm.serializeAddress(root, "guardianWallet", address(wallet));
        vm.serializeAddress(root, "demoLedger", address(ledger));
        vm.serializeAddress(root, "owner", owner);
        vm.serializeAddress(root, "agent", agent);
        vm.serializeAddress(root, "guardian", guardian);
        string memory json = vm.serializeAddress(root, "feeAccount", feeAccount);
        vm.writeJson(json, vm.envOr("DEPLOYMENTS_FILE", string.concat(vm.projectRoot(), "/../deployments/local.json")));
    }
}
