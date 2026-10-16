// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

abstract contract GuardianWalletBase is Test {
    uint256 internal constant UNIT = 1_000_000;
    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal guardian = makeAddr("guardian");
    address internal ana = makeAddr("ana");
    address internal bob = makeAddr("bob");
    address internal feeAccount = makeAddr("feeAccount");
    address internal attacker = makeAddr("attacker");
    DemoLedger internal ledger;
    GuardianWallet internal wallet;
    function setUp() public virtual {
        ledger = new DemoLedger(owner);
        IGuardianWallet.Policy memory policy = IGuardianWallet.Policy(500 * UNIT, 1_000 * UNIT, 200 * UNIT, 10 minutes, 1 days, UNIT / 10, 5 * UNIT);
        wallet = new GuardianWallet(owner, agent, guardian, address(ledger), feeAccount, policy);
        vm.startPrank(owner);
        ledger.setController(address(wallet));
        ledger.mint(address(wallet), DemoLedger.Currency.USD, 5_000 * UNIT);
        ledger.mint(address(wallet), DemoLedger.Currency.BDT, 500_000 * UNIT);
        wallet.setRecipient(ana, true, "Synthetic contact Ana");
        vm.warp(block.timestamp + 10 minutes);
        vm.stopPrank();
    }
    function _id(string memory label) internal pure returns (bytes32) { return keccak256(bytes(label)); }
    function _pay(address to, uint256 amount, bytes32 id) internal returns (IGuardianWallet.Outcome result) { vm.prank(agent); return wallet.pay(to, DemoLedger.Currency.USD, amount, id); }
    function _request(address to, uint256 amount, bytes32 id) internal returns (IGuardianWallet.Outcome result, uint256 pendingId) { vm.prank(agent); return wallet.requestApproval(to, DemoLedger.Currency.USD, amount, id); }
}
