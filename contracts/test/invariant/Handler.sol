// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {DemoLedger} from "../../src/DemoLedger.sol";
import {GuardianWallet} from "../../src/GuardianWallet.sol";

contract Handler is Test {
    GuardianWallet public wallet; DemoLedger public ledger;
    address public owner; address public agent; address public guardian; address public recipient; address public feeAccount;
    uint256 public constant UNIT = 1_000_000;
    bool public paidUnknown; bool public movedWhilePaused; bool public pendingFailed; bool public unauthorizedChanged; bool public agentEscaped;
    mapping(uint256 => uint256) public autonomousOut;
    uint256 nonce;
    constructor(GuardianWallet w, DemoLedger l, address o, address a, address g, address r, address f) { wallet=w; ledger=l; owner=o; agent=a; guardian=g; recipient=r; feeAccount=f; }
    function fresh() internal returns (bytes32) { return bytes32(++nonce); }
    function pay(uint96 raw) external {
        uint256 amount=bound(raw,1,250*UNIT); uint256 beforeBalance=ledger.balanceOf(recipient,DemoLedger.Currency.USD); bool stopped=wallet.paused();
        vm.prank(agent); wallet.pay(recipient,DemoLedger.Currency.USD,amount,fresh());
        uint256 moved=ledger.balanceOf(recipient,DemoLedger.Currency.USD)-beforeBalance; autonomousOut[block.timestamp/1 days] += moved;
        if(stopped && moved>0) movedWhilePaused=true;
    }
    function payUnknown(uint96 raw) external {
        address unknown=makeAddr("unknown"); uint256 beforeBalance=ledger.balanceOf(unknown,DemoLedger.Currency.USD);
        vm.prank(agent); wallet.pay(unknown,DemoLedger.Currency.USD,bound(raw,1,100*UNIT),fresh());
        if(ledger.balanceOf(unknown,DemoLedger.Currency.USD)>beforeBalance) paidUnknown=true;
    }
    function serviceFee(uint96 raw) external {
        uint256 beforeBalance=ledger.balanceOf(feeAccount,DemoLedger.Currency.USD); bool stopped=wallet.paused();
        vm.prank(agent); wallet.payServiceFee(bound(raw,1,UNIT),fresh());
        if(stopped && ledger.balanceOf(feeAccount,DemoLedger.Currency.USD)>beforeBalance) movedWhilePaused=true;
    }
    function save(uint96 raw) external {
        uint256 beforeBalance=ledger.savingsBalance(address(wallet),DemoLedger.Currency.USD); bool stopped=wallet.paused();
        vm.prank(agent); wallet.saveToSavings(DemoLedger.Currency.USD,bound(raw,1,100*UNIT),fresh());
        if(stopped && ledger.savingsBalance(address(wallet),DemoLedger.Currency.USD)>beforeBalance) movedWhilePaused=true;
    }
    function requestAndApprove(uint96 raw,bool late,bool twice) external {
        uint256 amount=bound(raw,200*UNIT,500*UNIT); vm.prank(agent); (,uint256 id)=wallet.requestApproval(recipient,DemoLedger.Currency.USD,amount,fresh()); if(id==0)return;
        if(late)vm.warp(block.timestamp+1 days+1); uint256 beforeBalance=ledger.balanceOf(recipient,DemoLedger.Currency.USD);
        vm.prank(owner); try wallet.approve(id) {} catch {}
        uint256 moved=ledger.balanceOf(recipient,DemoLedger.Currency.USD)-beforeBalance; if((late&&moved>0)||moved>amount)pendingFailed=true;
        if(twice){vm.prank(owner);try wallet.approve(id){pendingFailed=true;}catch{}}
    }
    function togglePause(bool on) external {vm.prank(owner);if(on)wallet.pause();else wallet.unpause();}
    function guardianUnpause() external {vm.prank(guardian);(bool ok,)=address(wallet).call(abi.encodeCall(wallet.unpause,()));if(ok)unauthorizedChanged=true;}
    function agentOwnerCall(uint8 which) external {bytes memory data=which%2==0?abi.encodeCall(wallet.setAgent,(makeAddr("bad"))):abi.encodeCall(wallet.setFeeAccount,(makeAddr("badFee")));vm.prank(agent);(bool ok,)=address(wallet).call(data);if(ok)agentEscaped=true;}
    function warp(uint32 delta) external {vm.warp(block.timestamp+bound(delta,0,2 days));}
}
