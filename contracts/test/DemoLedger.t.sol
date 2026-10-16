// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DemoLedger} from "../src/DemoLedger.sol";

contract DemoLedgerTest is Test {
    bytes3 constant USD = "USD";
    bytes3 constant CNY = "CNY";
    DemoLedger ledger;
    address owner = makeAddr("owner");
    address controller = makeAddr("controller");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    function setUp() public {
        ledger = new DemoLedger(owner);
        vm.startPrank(owner);
        ledger.addCurrency(USD, 6, "US dollar (demo units)");
        ledger.addCurrency(CNY, 6, "Chinese yuan (demo units)");
        ledger.setController(controller);
        ledger.mint(alice, USD, 10_000);
        vm.stopPrank();
    }
    function test_mintOnlyOwner() public { vm.expectRevert(); ledger.mint(alice, USD, 1); }
    function test_balancesMoveOnlyThroughController() public {
        vm.expectRevert(DemoLedger.NotController.selector); ledger.move(alice, bob, USD, 1);
        vm.prank(controller); ledger.move(alice, bob, USD, 4_000);
        assertEq(ledger.balanceOf(alice, USD), 6_000); assertEq(ledger.balanceOf(bob, USD), 4_000);
    }
    function test_savingsSimpleInterestComputedOnRead() public {
        vm.prank(controller); ledger.save(alice, USD, 10_000); vm.warp(block.timestamp + 365 days);
        assertEq(ledger.savingsBalance(alice, USD), 10_500);
        vm.prank(controller); ledger.withdrawSavings(alice, USD, 500);
        assertEq(ledger.balanceOf(alice, USD), 500); assertEq(ledger.savingsBalance(alice, USD), 10_000);
    }
    function testFuzz_currencyBalancesAreIndependent(uint96 usd, uint96 cny) public {
        vm.startPrank(owner); ledger.mint(bob, USD, usd); ledger.mint(bob, CNY, cny); vm.stopPrank();
        assertEq(ledger.balanceOf(bob, USD), usd); assertEq(ledger.balanceOf(bob, CNY), cny);
    }
    function test_registryListsConfiguredCurrencies() public view {
        bytes3[] memory codes = ledger.currencies();
        assertEq(codes.length, 2); assertEq(codes[0], USD); assertEq(codes[1], CNY);
        (bool listed, uint8 decimals, string memory name) = ledger.currencyInfo(CNY);
        assertTrue(listed); assertEq(decimals, 6); assertEq(name, "Chinese yuan (demo units)");
    }
    function test_addCurrencyOnlyOwner() public {
        vm.prank(alice); vm.expectRevert(); ledger.addCurrency("SGD", 6, "Singapore dollar (demo units)");
        vm.prank(controller); vm.expectRevert(); ledger.addCurrency("SGD", 6, "Singapore dollar (demo units)");
    }
    function test_addCurrencyValidatesCodeDecimalsAndDuplicates() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(DemoLedger.InvalidCurrency.selector, bytes3("usd"))); ledger.addCurrency("usd", 6, "lower case");
        vm.expectRevert(abi.encodeWithSelector(DemoLedger.InvalidCurrency.selector, bytes3("U1D"))); ledger.addCurrency("U1D", 6, "digit");
        vm.expectRevert(abi.encodeWithSelector(DemoLedger.InvalidCurrency.selector, bytes3(0))); ledger.addCurrency(bytes3(0), 6, "empty");
        vm.expectRevert(abi.encodeWithSelector(DemoLedger.InvalidCurrency.selector, bytes3("JPY"))); ledger.addCurrency("JPY", 19, "too many decimals");
        vm.expectRevert(abi.encodeWithSelector(DemoLedger.CurrencyAlreadyListed.selector, USD)); ledger.addCurrency(USD, 6, "again");
        vm.stopPrank();
    }
    function test_unknownCurrencyCannotBeMintedOrMoved() public {
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(DemoLedger.UnknownCurrency.selector, bytes3("SGD"))); ledger.mint(alice, "SGD", 1);
        vm.prank(controller); vm.expectRevert(abi.encodeWithSelector(DemoLedger.UnknownCurrency.selector, bytes3("SGD"))); ledger.move(alice, bob, "SGD", 1);
        vm.prank(controller); vm.expectRevert(abi.encodeWithSelector(DemoLedger.UnknownCurrency.selector, bytes3("SGD"))); ledger.save(alice, "SGD", 1);
    }
    function test_thirdCurrencyWorksOnceListed() public {
        vm.startPrank(owner);
        ledger.addCurrency("SGD", 6, "Singapore dollar (demo units)");
        ledger.mint(alice, "SGD", 700);
        vm.stopPrank();
        vm.prank(controller); ledger.move(alice, bob, "SGD", 200);
        assertEq(ledger.balanceOf(alice, "SGD"), 500); assertEq(ledger.balanceOf(bob, "SGD"), 200);
        assertEq(ledger.currencies().length, 3);
    }
}
