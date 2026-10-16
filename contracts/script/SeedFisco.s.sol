// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CurrencyConfig} from "./CurrencyConfig.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

/// @notice Seeds only synthetic demo state on the local FISCO chain.
contract SeedFisco is CurrencyConfig {
    uint256 internal constant UNIT = 1_000_000;

    function run() external {
        require(block.chainid == 1337, "local FISCO chain only");
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        DemoLedger ledger = DemoLedger(vm.envAddress("DEMO_LEDGER_ADDRESS"));
        GuardianWallet wallet = GuardianWallet(vm.envAddress("GUARDIAN_WALLET_ADDRESS"));

        DemoCurrency[] memory units = _currencies();
        vm.startBroadcast(ownerKey);
        _listCurrencies(ledger, units);
        _seedCurrencies(ledger, address(wallet), units);
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_1_ADDRESS"), true, "Ana - synthetic designer");
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_2_ADDRESS"), true, "Bob - synthetic landlord");
        wallet.setRecipient(vm.envAddress("DEMO_CONTACT_3_ADDRESS"), true, "Chen - synthetic supplier");
        wallet.setPolicy(_demoPolicy());
        vm.stopBroadcast();
    }

    function _demoPolicy() internal pure returns (IGuardianWallet.Policy memory) {
        return IGuardianWallet.Policy(500 * UNIT, 1_000 * UNIT, 200 * UNIT, 10 minutes, 1 days, 100_000, 5 * UNIT);
    }
}
