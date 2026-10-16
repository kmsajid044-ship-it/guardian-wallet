// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {DemoLedger} from "../src/DemoLedger.sol";

/// @notice Reads the demo ledger units from config/currencies.json, the single source of currencies.
///         Adding an entry there lists a new demo unit at deployment without code changes.
abstract contract CurrencyConfig is Script {
    struct DemoCurrency {
        bytes3 code;
        uint8 decimals;
        string name;
        uint256 seedMinorUnits;
    }

    function _currencies() internal view returns (DemoCurrency[] memory list) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../config/currencies.json"));
        uint256 count;
        while (vm.keyExistsJson(json, string.concat(".currencies[", vm.toString(count), "]"))) count++;
        require(count > 0, "config/currencies.json lists no currencies");
        list = new DemoCurrency[](count);
        for (uint256 i; i < count; i++) {
            string memory key = string.concat(".currencies[", vm.toString(i), "]");
            bytes memory code = bytes(vm.parseJsonString(json, string.concat(key, ".code")));
            require(code.length == 3, "currency code must have three letters");
            uint8 decimals = uint8(vm.parseJsonUint(json, string.concat(key, ".decimals")));
            uint256 seed = vm.keyExistsJson(json, string.concat(key, ".seed")) ? vm.parseUint(vm.parseJsonString(json, string.concat(key, ".seed"))) : 0;
            list[i] = DemoCurrency(bytes3(code), decimals, vm.parseJsonString(json, string.concat(key, ".name")), seed * 10 ** decimals);
        }
    }

    function _listCurrencies(DemoLedger ledger, DemoCurrency[] memory list) internal {
        for (uint256 i; i < list.length; i++) if (!ledger.isCurrency(list[i].code)) ledger.addCurrency(list[i].code, list[i].decimals, list[i].name);
    }

    function _seedCurrencies(DemoLedger ledger, address wallet, DemoCurrency[] memory list) internal {
        for (uint256 i; i < list.length; i++) if (list[i].seedMinorUnits > 0) ledger.mint(wallet, list[i].code, list[i].seedMinorUnits);
    }
}
