// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {GuardianWalletBase} from "./GuardianWalletBase.sol";
import {DemoLedger} from "../src/DemoLedger.sol";
import {GuardianWallet} from "../src/GuardianWallet.sol";
import {IGuardianWallet} from "../src/interfaces/IGuardianWallet.sol";

contract GuardianWalletTest is GuardianWalletBase {
    function test_payExecutesBelowThreshold() public {
        assertEq(uint8(_pay(ana, 100 * UNIT, _id("pay"))), uint8(IGuardianWallet.Outcome.EXECUTED));
        assertEq(ledger.balanceOf(ana, DemoLedger.Currency.USD), 100 * UNIT);
    }
    function test_payAboveThresholdIsBlockedAndDoesNotRevert() public {
        vm.expectEmit(true, false, false, true);
        emit IGuardianWallet.PolicyViolation(_id("large"), IGuardianWallet.Action.PAY, IGuardianWallet.Reason.BELOW_APPROVAL_THRESHOLD, 200 * UNIT);
        assertEq(uint8(_pay(ana, 200 * UNIT, _id("large"))), uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_requestApprovalCreatesPendingAndOwnerExecutesOnce() public {
        (IGuardianWallet.Outcome result, uint256 id) = _request(ana, 300 * UNIT, _id("approval"));
        assertEq(uint8(result), uint8(IGuardianWallet.Outcome.PENDING));
        vm.prank(owner); wallet.approve(id);
        assertEq(ledger.balanceOf(ana, DemoLedger.Currency.USD), 300 * UNIT);
        vm.prank(owner); vm.expectRevert(); wallet.approve(id);
    }
    function test_pendingCannotExecuteAfterExpiry() public {
        (, uint256 id) = _request(ana, 300 * UNIT, _id("expiry"));
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(owner); vm.expectRevert(); wallet.approve(id);
        wallet.expire(id);
        assertEq(uint8(wallet.getPending(id).status), uint8(IGuardianWallet.PendingStatus.EXPIRED));
    }
    function test_recipientCooldown() public {
        vm.prank(owner); wallet.setRecipient(bob, true, "Synthetic contact Bob");
        assertEq(uint8(_pay(bob, UNIT, _id("early"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.warp(block.timestamp + 10 minutes);
        assertEq(uint8(_pay(bob, UNIT, _id("ready"))), uint8(IGuardianWallet.Outcome.EXECUTED));
    }
    function test_dailyBucketResets() public {
        for (uint256 i; i < 5; i++) _pay(ana, 199 * UNIT, bytes32(i + 1));
        assertEq(uint8(_pay(ana, 10 * UNIT, _id("over"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.warp((wallet.currentDay() + 1) * 1 days);
        assertEq(uint8(_pay(ana, 10 * UNIT, _id("next"))), uint8(IGuardianWallet.Outcome.EXECUTED));
    }
    function test_saveToSavingsAndOwnerWithdraw() public {
        vm.prank(agent); assertEq(uint8(wallet.saveToSavings(DemoLedger.Currency.USD, 1_000 * UNIT, _id("save"))), uint8(IGuardianWallet.Outcome.EXECUTED));
        assertEq(ledger.savingsBalance(address(wallet), DemoLedger.Currency.USD), 1_000 * UNIT);
        vm.warp(block.timestamp + 365 days);
        vm.prank(owner); wallet.withdrawSavings(DemoLedger.Currency.USD, 50 * UNIT);
        assertEq(ledger.savingsBalance(address(wallet), DemoLedger.Currency.USD), 1_000 * UNIT);
    }
    function test_payServiceFeeUsesSeparateBudget() public {
        vm.prank(agent); assertEq(uint8(wallet.payServiceFee(50_000, _id("fee"))), uint8(IGuardianWallet.Outcome.EXECUTED));
        assertEq(ledger.balanceOf(feeAccount, DemoLedger.Currency.USD), 50_000);
        assertEq(wallet.spentToday(), 0); assertEq(wallet.opsSpentToday(), 50_000);
    }
    function test_pauseRolesAndOwnerOnlyUnpause() public {
        vm.prank(guardian); wallet.pause();
        assertEq(uint8(_pay(ana, UNIT, _id("paused"))), uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.prank(guardian); vm.expectRevert(); wallet.unpause();
        vm.prank(owner); wallet.unpause();
        assertEq(uint8(_pay(ana, UNIT, _id("resumed"))), uint8(IGuardianWallet.Outcome.EXECUTED));
    }
    function test_onlyAgentCanCallFourFunctions() public {
        vm.expectRevert(IGuardianWallet.NotAgent.selector); wallet.pay(ana, DemoLedger.Currency.USD, 1, _id("1"));
        vm.expectRevert(IGuardianWallet.NotAgent.selector); wallet.requestApproval(ana, DemoLedger.Currency.USD, 200 * UNIT, _id("2"));
        vm.expectRevert(IGuardianWallet.NotAgent.selector); wallet.saveToSavings(DemoLedger.Currency.USD, 1, _id("3"));
        vm.expectRevert(IGuardianWallet.NotAgent.selector); wallet.payServiceFee(1, _id("4"));
    }
    function testFuzz_payNeverExceedsPerTransfer(uint256 amount) public {
        amount = bound(amount, 1, 2_000 * UNIT);
        IGuardianWallet.Outcome result = _pay(ana, amount, _id("fuzz"));
        if (amount >= 200 * UNIT) assertEq(uint8(result), uint8(IGuardianWallet.Outcome.BLOCKED));
        else assertEq(uint8(result), uint8(IGuardianWallet.Outcome.EXECUTED));
    }
    function testFuzz_serviceBudget(uint96 raw) public {
        uint256 amount = bound(raw, 1, 2 * UNIT);
        vm.prank(agent); IGuardianWallet.Outcome result = wallet.payServiceFee(amount, _id("service-fuzz"));
        if (amount > UNIT / 10) assertEq(uint8(result), uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_policyOnlyOwner() public {
        IGuardianWallet.Policy memory p = wallet.getPolicy();
        vm.prank(attacker); vm.expectRevert(); wallet.setPolicy(p);
        vm.prank(attacker); vm.expectRevert(); wallet.setRecipient(bob, true, "Bob");
        vm.prank(attacker); vm.expectRevert(); wallet.setAgent(attacker);
        vm.prank(attacker); vm.expectRevert(); wallet.setFeeAccount(attacker);
    }
    function test_violation_ZERO_AMOUNT() public { assertEq(uint8(_pay(ana, 0, _id("zero"))), uint8(IGuardianWallet.Outcome.BLOCKED)); }
    function test_violation_DUPLICATE_INTENT() public {
        bytes32 id = _id("duplicate"); _pay(ana, UNIT, id); assertEq(uint8(_pay(ana, UNIT, id)), uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_violation_RECIPIENT_NOT_ALLOWED() public { assertEq(uint8(_pay(attacker, UNIT, _id("unknown"))), uint8(IGuardianWallet.Outcome.BLOCKED)); }
    function test_violation_OVER_PER_TX_LIMIT() public { (,uint256 id)=_request(ana, 501*UNIT, _id("too-large")); assertEq(id,0); }
    function test_violation_BELOW_APPROVAL_THRESHOLD() public { (,uint256 id)=_request(ana, 199*UNIT, _id("too-small")); assertEq(id,0); }
    function test_violation_OVER_DAILY_LIMIT() public {
        for(uint256 i;i<5;i++) _pay(ana,199*UNIT,bytes32(100+i)); assertEq(uint8(_pay(ana,10*UNIT,_id("daily"))),uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_violation_INSUFFICIENT_BALANCE() public {
        vm.startPrank(owner); ledger.mint(address(wallet),DemoLedger.Currency.USD,0); vm.stopPrank();
        vm.prank(agent); wallet.saveToSavings(DemoLedger.Currency.USD,4_999*UNIT,_id("park"));
        assertEq(uint8(_pay(ana,2*UNIT,_id("empty"))),uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_violation_OVER_OPS_PER_CALL() public { vm.prank(agent); assertEq(uint8(wallet.payServiceFee(100_001,_id("fee-cap"))),uint8(IGuardianWallet.Outcome.BLOCKED)); }
    function test_violation_OVER_OPS_DAILY() public {
        for(uint256 i;i<50;i++){vm.prank(agent);wallet.payServiceFee(100_000,bytes32(200+i));}
        vm.prank(agent);assertEq(uint8(wallet.payServiceFee(1,_id("fee-day"))),uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_allAgentFunctionsBlockedWhilePaused() public {
        vm.prank(owner);wallet.pause();
        assertEq(uint8(_pay(ana,UNIT,_id("p1"))),uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.prank(agent);(IGuardianWallet.Outcome approvalResult,)=wallet.requestApproval(ana,DemoLedger.Currency.USD,200*UNIT,_id("p2"));assertEq(uint8(approvalResult),uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.prank(agent);assertEq(uint8(wallet.saveToSavings(DemoLedger.Currency.USD,UNIT,_id("p3"))),uint8(IGuardianWallet.Outcome.BLOCKED));
        vm.prank(agent);assertEq(uint8(wallet.payServiceFee(1,_id("p4"))),uint8(IGuardianWallet.Outcome.BLOCKED));
    }
    function test_agentCannotCallOwnerFunctions() public {
        IGuardianWallet.Policy memory p = wallet.getPolicy();
        vm.startPrank(agent);
        vm.expectRevert(); wallet.setPolicy(p);
        vm.expectRevert(); wallet.setRecipient(bob, true, "Bob");
        vm.expectRevert(); wallet.setAgent(attacker);
        vm.expectRevert(); wallet.setGuardian(attacker);
        vm.expectRevert(); wallet.setFeeAccount(attacker);
        vm.expectRevert(); wallet.unpause();
        vm.stopPrank();
    }
}
