// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {GuardianWalletBase} from "../GuardianWalletBase.sol";
import {Handler} from "./Handler.sol";
import {DemoLedger} from "../../src/DemoLedger.sol";

contract GuardianWalletInvariants is GuardianWalletBase {
    Handler handler;
    function setUp() public override {super.setUp();handler=new Handler(wallet,ledger,owner,agent,guardian,ana,feeAccount);targetContract(address(handler));}
    function invariant_I1_dailyOutflowWithinLimit() public view {assertLe(handler.autonomousOut(block.timestamp/1 days),wallet.getPolicy().dailyLimit);}
    function invariant_I2_onlyActiveAllowlistedRecipients() public view {assertFalse(handler.paidUnknown());}
    function invariant_I3_noValueMovesWhilePaused() public view {assertFalse(handler.movedWhilePaused());}
    function invariant_I4_pendingExecutesOnceBeforeExpiry() public view {assertFalse(handler.pendingFailed());}
    /// @dev Savings exist only on the wallet's own sub-account and never fall below what was deposited
    ///      (the handler never withdraws; interest only adds).
    function invariant_I5_savingsOwnedByWallet() public view {
        address[5] memory others=[owner,agent,guardian,ana,feeAccount];
        for(uint256 i;i<others.length;i++){assertEq(ledger.savingsBalance(others[i],DemoLedger.Currency.USD),0);assertEq(ledger.savingsBalance(others[i],DemoLedger.Currency.BDT),0);}
        assertGe(ledger.savingsBalance(address(wallet),DemoLedger.Currency.USD),handler.totalSavedUsd());
    }
    function invariant_I6_onlyOwnerChangesConfig() public view {assertFalse(handler.unauthorizedChanged());assertEq(wallet.owner(),owner);}
    function invariant_I7_agentLimitedToFourFunctions() public view {assertFalse(handler.agentEscaped());assertEq(wallet.agent(),agent);}
    function invariant_I8_opsBudgetSeparate() public view {assertLe(wallet.opsSpentToday(),wallet.getPolicy().opsDailyLimit);assertEq(ledger.balanceOf(feeAccount,DemoLedger.Currency.BDT),0);}
}
