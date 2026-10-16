// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DemoLedger} from "../src/DemoLedger.sol";

contract DemoLedgerTest is Test {
    DemoLedger ledger;
    address owner = makeAddr("owner");
    address controller = makeAddr("controller");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    function setUp() public { ledger = new DemoLedger(owner); vm.prank(owner); ledger.setController(controller); vm.prank(owner); ledger.mint(alice, DemoLedger.Currency.USD, 10_000); }
    function test_mintOnlyOwner() public { vm.expectRevert(); ledger.mint(alice, DemoLedger.Currency.USD, 1); }
    function test_balancesMoveOnlyThroughController() public {
        vm.expectRevert(DemoLedger.NotController.selector); ledger.move(alice, bob, DemoLedger.Currency.USD, 1);
        vm.prank(controller); ledger.move(alice, bob, DemoLedger.Currency.USD, 4_000);
        assertEq(ledger.balanceOf(alice, DemoLedger.Currency.USD), 6_000); assertEq(ledger.balanceOf(bob, DemoLedger.Currency.USD), 4_000);
    }
    function test_savingsSimpleInterestComputedOnRead() public {
        vm.prank(controller); ledger.save(alice, DemoLedger.Currency.USD, 10_000); vm.warp(block.timestamp + 365 days);
        assertEq(ledger.savingsBalance(alice, DemoLedger.Currency.USD), 10_500);
        vm.prank(controller); ledger.withdrawSavings(alice, DemoLedger.Currency.USD, 500);
        assertEq(ledger.balanceOf(alice, DemoLedger.Currency.USD), 500); assertEq(ledger.savingsBalance(alice, DemoLedger.Currency.USD), 10_000);
    }
    function testFuzz_currencyBalancesAreIndependent(uint96 usd, uint96 bdt) public {
        vm.startPrank(owner); ledger.mint(bob, DemoLedger.Currency.USD, usd); ledger.mint(bob, DemoLedger.Currency.BDT, bdt); vm.stopPrank();
        assertEq(ledger.balanceOf(bob, DemoLedger.Currency.USD), usd); assertEq(ledger.balanceOf(bob, DemoLedger.Currency.BDT), bdt);
    }
}
