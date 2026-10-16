// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

/// @notice FISCO BCOS reports block.timestamp in milliseconds. Policy durations are seconds on
///         every backend, so a day, a cooldown, an expiry, and a savings year must not shrink 1000x.
contract MillisecondClockTest is Test {
    uint256 internal constant UNIT = 1_000_000;
    uint256 internal constant MS = 1_000;
    bytes3 internal constant USD = "USD";
    uint256 internal constant START_MS = 1_792_000_000_000; // a 2026 wall-clock time in milliseconds
    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal ana = makeAddr("ana");
    address internal bob = makeAddr("bob");
    DemoLedger internal ledger;
    GuardianWallet internal wallet;

    function setUp() public {
        vm.warp(START_MS);
        ledger = new DemoLedger(owner);
        IGuardianWallet.Policy memory policy = IGuardianWallet.Policy(500 * UNIT, 1_000 * UNIT, 200 * UNIT, 10 minutes, 1 days, UNIT / 10, 5 * UNIT);
        wallet = new GuardianWallet(owner, agent, address(0), address(ledger), makeAddr("fee"), policy);
        vm.startPrank(owner);
        ledger.addCurrency(USD, 6, "US dollar (demo units)");
        ledger.setController(address(wallet));
        ledger.mint(address(wallet), USD, 5_000 * UNIT);
        wallet.setRecipient(ana, true, "Synthetic contact Ana");
        vm.stopPrank();
        vm.warp(block.timestamp + 10 minutes * MS);
    }

    function _pay(address to, uint256 amount, bytes32 id) internal returns (IGuardianWallet.Outcome) { vm.prank(agent); return wallet.pay(to, USD, amount, id); }

    /// @dev Moves forward to one minute into the next day and spends 995 of the 1,000 allowance.
    function _spendDailyAllowance() internal {
        vm.warp(((wallet.currentDay() + 1) * 1 days + 60) * MS);
        for (uint256 i; i < 5; i++) assertEq(uint8(_pay(ana, 199 * UNIT, bytes32(i + 1))), uint8(IGuardianWallet.Outcome.EXECUTED));
        assertEq(wallet.spentToday(), 995 * UNIT);
    }

    function test_detectsMillisecondClock() public view {
        assertEq(wallet.clockScale(), 1_000);
        assertEq(ledger.clockScale(), 1_000);
        assertEq(wallet.currentDay(), block.timestamp / MS / 1 days);
    }

    function test_secondClockKeepsScaleOne() public {
        vm.warp(1_792_000_000);
        DemoLedger secondsLedger = new DemoLedger(owner);
        assertEq(secondsLedger.clockScale(), 1);
    }

    function test_dailyLimitHoldsForAWholeDayOfMilliseconds() public {
        _spendDailyAllowance();
        vm.warp(block.timestamp + 2 minutes * MS); // longer than 86,400 ms
        assertEq(uint8(_pay(ana, 199 * UNIT, keccak256("later"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.warp((wallet.currentDay() + 1) * 1 days * MS);
        assertEq(uint8(_pay(ana, 199 * UNIT, keccak256("next-day"))), uint8(IGuardianWallet.Outcome.EXECUTED));
    }

    function testFuzz_dailyLimitHoldsUntilTheDayEnds(uint64 delta) public {
        _spendDailyAllowance();
        uint256 dayEnd = (wallet.currentDay() + 1) * 1 days * MS;
        vm.warp(block.timestamp + bound(delta, 0, dayEnd - block.timestamp - 1));
        assertEq(uint8(_pay(ana, 199 * UNIT, keccak256("same-day"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        assertLe(wallet.spentToday(), 1_000 * UNIT);
    }

    function test_pendingExpiryIsADayNotEightySixSeconds() public {
        vm.prank(agent); (, uint256 first) = wallet.requestApproval(ana, USD, 250 * UNIT, keccak256("first"));
        vm.warp(block.timestamp + 2 minutes * MS);
        vm.prank(owner); wallet.approve(first);
        vm.prank(agent); (, uint256 second) = wallet.requestApproval(ana, USD, 250 * UNIT, keccak256("second"));
        vm.warp(block.timestamp + (1 days + 1) * MS);
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(IGuardianWallet.PendingHasExpired.selector, second)); wallet.approve(second);
    }

    function test_recipientCooldownIsMinutesNotMilliseconds() public {
        vm.prank(owner); wallet.setRecipient(bob, true, "Synthetic contact Bob");
        vm.warp(block.timestamp + 5 minutes * MS);
        assertEq(uint8(_pay(bob, UNIT, keccak256("early"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.warp(block.timestamp + 5 minutes * MS);
        assertEq(uint8(_pay(bob, UNIT, keccak256("ready"))), uint8(IGuardianWallet.Outcome.EXECUTED));
        assertEq(wallet.getRecipient(bob).activeAfter, (START_MS / MS) + 10 minutes + 10 minutes);
    }

    function test_savingsInterestUsesSecondsYear() public {
        vm.prank(agent); wallet.saveToSavings(USD, 10_000, keccak256("save"));
        vm.warp(block.timestamp + 365 days * MS);
        assertEq(ledger.savingsBalance(address(wallet), USD), 10_500);
    }
}
