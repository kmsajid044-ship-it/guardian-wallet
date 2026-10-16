// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DemoLedger} from "./DemoLedger.sol";
import {IGuardianWallet} from "./interfaces/IGuardianWallet.sol";

/// @notice Policy controller for USD and BDT demo balances. No real money is represented.
contract GuardianWallet is IGuardianWallet, Ownable2Step, ReentrancyGuard {
    DemoLedger public immutable ledger;
    address public agent;
    address public guardian;
    address public feeAccount;
    bool public paused;
    Policy private _policy;
    mapping(address => Recipient) private _recipients;
    uint256 private _spentToday;
    uint256 private _spentDay;
    uint256 private _opsSpentToday;
    uint256 private _opsDay;
    mapping(bytes32 => bool) public usedIntent;
    mapping(uint256 => Pending) private _pendings;
    uint256 public pendingCount;

    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }

    constructor(address owner_, address agent_, address guardian_, address ledger_, address feeAccount_, Policy memory policy_)
        Ownable(owner_)
    {
        if (agent_ == address(0) || ledger_ == address(0) || feeAccount_ == address(0)) revert ZeroAddress();
        _validatePolicy(policy_);
        agent = agent_;
        guardian = guardian_;
        ledger = DemoLedger(ledger_);
        feeAccount = feeAccount_;
        _policy = policy_;
        emit AgentSet(address(0), agent_);
        emit GuardianSet(address(0), guardian_);
        emit FeeAccountSet(feeAccount_);
        emit PolicyUpdated(policy_);
    }

    function pay(address to, DemoLedger.Currency currency, uint256 amount, bytes32 intentId)
        external nonReentrant onlyAgent returns (Outcome)
    {
        Action action = Action.PAY;
        Outcome common = _checkCommon(intentId, action, amount);
        if (common == Outcome.BLOCKED) return common;
        Recipient storage r = _recipients[to];
        if (!r.allowed) return _violation(intentId, action, Reason.RECIPIENT_NOT_ALLOWED, amount);
        if (block.timestamp < r.activeAfter) return _violation(intentId, action, Reason.RECIPIENT_NOT_ACTIVE, amount);
        if (amount > _policy.perTxLimit) return _violation(intentId, action, Reason.OVER_PER_TX_LIMIT, amount);
        if (amount >= _policy.approvalThreshold) return _violation(intentId, action, Reason.BELOW_APPROVAL_THRESHOLD, amount);
        _rollDay();
        if (_spentToday + amount > _policy.dailyLimit) return _violation(intentId, action, Reason.OVER_DAILY_LIMIT, amount);
        if (ledger.balanceOf(address(this), currency) < amount) return _violation(intentId, action, Reason.INSUFFICIENT_BALANCE, amount);
        usedIntent[intentId] = true;
        _spentToday += amount;
        ledger.move(address(this), to, currency, amount);
        emit PaymentCompleted(intentId, uint8(currency), to, amount);
        return Outcome.EXECUTED;
    }

    function requestApproval(address to, DemoLedger.Currency currency, uint256 amount, bytes32 intentId)
        external nonReentrant onlyAgent returns (Outcome outcome, uint256 pendingId)
    {
        Action action = Action.REQUEST_APPROVAL;
        Outcome common = _checkCommon(intentId, action, amount);
        if (common == Outcome.BLOCKED) return (common, 0);
        Recipient storage r = _recipients[to];
        if (!r.allowed) return (_violation(intentId, action, Reason.RECIPIENT_NOT_ALLOWED, amount), 0);
        if (block.timestamp < r.activeAfter) return (_violation(intentId, action, Reason.RECIPIENT_NOT_ACTIVE, amount), 0);
        if (amount > _policy.perTxLimit) return (_violation(intentId, action, Reason.OVER_PER_TX_LIMIT, amount), 0);
        if (amount < _policy.approvalThreshold) return (_violation(intentId, action, Reason.BELOW_APPROVAL_THRESHOLD, amount), 0);
        usedIntent[intentId] = true;
        pendingId = ++pendingCount;
        uint64 expiresAt = uint64(block.timestamp) + _policy.pendingExpiry;
        _pendings[pendingId] = Pending(uint8(currency), to, amount, intentId, uint64(block.timestamp), expiresAt, PendingStatus.PENDING);
        emit ApprovalRequested(pendingId, intentId, uint8(currency), to, amount, expiresAt);
        return (Outcome.PENDING, pendingId);
    }

    function saveToSavings(DemoLedger.Currency currency, uint256 amount, bytes32 intentId)
        external nonReentrant onlyAgent returns (Outcome)
    {
        Action action = Action.SAVE_TO_SAVINGS;
        Outcome common = _checkCommon(intentId, action, amount);
        if (common == Outcome.BLOCKED) return common;
        if (ledger.balanceOf(address(this), currency) < amount) return _violation(intentId, action, Reason.INSUFFICIENT_BALANCE, amount);
        usedIntent[intentId] = true;
        ledger.save(address(this), currency, amount);
        emit SavingsFunded(intentId, uint8(currency), amount);
        return Outcome.EXECUTED;
    }

    function payServiceFee(uint256 amount, bytes32 requestId) external nonReentrant onlyAgent returns (Outcome) {
        Action action = Action.PAY_SERVICE_FEE;
        Outcome common = _checkCommon(requestId, action, amount);
        if (common == Outcome.BLOCKED) return common;
        if (amount > _policy.opsPerCallLimit) return _violation(requestId, action, Reason.OVER_OPS_PER_CALL, amount);
        _rollOpsDay();
        if (_opsSpentToday + amount > _policy.opsDailyLimit) return _violation(requestId, action, Reason.OVER_OPS_DAILY, amount);
        if (ledger.balanceOf(address(this), DemoLedger.Currency.USD) < amount) return _violation(requestId, action, Reason.INSUFFICIENT_BALANCE, amount);
        usedIntent[requestId] = true;
        _opsSpentToday += amount;
        ledger.move(address(this), feeAccount, DemoLedger.Currency.USD, amount);
        emit ServiceFeePaid(requestId, feeAccount, amount);
        return Outcome.EXECUTED;
    }

    function approve(uint256 pendingId) external nonReentrant onlyOwner {
        Pending storage p = _pendings[pendingId];
        if (p.status != PendingStatus.PENDING) revert PendingNotActive(pendingId);
        if (block.timestamp > p.expiresAt) revert PendingHasExpired(pendingId);
        Recipient storage r = _recipients[p.to];
        if (!r.allowed) revert PendingNoLongerValid(pendingId, Reason.RECIPIENT_NOT_ALLOWED);
        if (block.timestamp < r.activeAfter) revert PendingNoLongerValid(pendingId, Reason.RECIPIENT_NOT_ACTIVE);
        DemoLedger.Currency currency = DemoLedger.Currency(p.currency);
        if (ledger.balanceOf(address(this), currency) < p.amount) revert PendingNoLongerValid(pendingId, Reason.INSUFFICIENT_BALANCE);
        p.status = PendingStatus.EXECUTED;
        _rollDay();
        _spentToday += p.amount;
        ledger.move(address(this), p.to, currency, p.amount);
        emit PendingApproved(pendingId, p.intentId, p.to, p.amount);
    }

    function reject(uint256 pendingId) external onlyOwner {
        Pending storage p = _pendings[pendingId];
        if (p.status != PendingStatus.PENDING) revert PendingNotActive(pendingId);
        p.status = PendingStatus.REJECTED;
        emit PendingRejected(pendingId, p.intentId);
    }
    function expire(uint256 pendingId) external {
        Pending storage p = _pendings[pendingId];
        if (p.status != PendingStatus.PENDING) revert PendingNotActive(pendingId);
        if (block.timestamp <= p.expiresAt) revert PendingNotExpired(pendingId);
        p.status = PendingStatus.EXPIRED;
        emit PendingExpired(pendingId, p.intentId);
    }
    function withdrawSavings(DemoLedger.Currency currency, uint256 amount) external onlyOwner { ledger.withdrawSavings(address(this), currency, amount); }
    function setPolicy(Policy calldata policy_) external onlyOwner { _validatePolicy(policy_); _policy = policy_; emit PolicyUpdated(policy_); }
    function setRecipient(address recipient, bool allowed, string calldata label) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        Recipient storage r = _recipients[recipient];
        if (!allowed) { r.allowed = false; r.activeAfter = 0; }
        else if (!r.allowed) { r.allowed = true; r.activeAfter = uint64(block.timestamp) + _policy.recipientCooldown; }
        r.label = label;
        emit RecipientSet(recipient, r.allowed, r.activeAfter, label);
    }
    function setFeeAccount(address account) external onlyOwner { if (account == address(0)) revert ZeroAddress(); feeAccount = account; emit FeeAccountSet(account); }
    function setAgent(address newAgent) external onlyOwner { if (newAgent == address(0)) revert ZeroAddress(); emit AgentSet(agent, newAgent); agent = newAgent; }
    function setGuardian(address newGuardian) external onlyOwner { emit GuardianSet(guardian, newGuardian); guardian = newGuardian; }
    function pause() external { if (msg.sender != owner() && (msg.sender != guardian || guardian == address(0))) revert NotOwnerOrGuardian(); paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }
    function renounceOwnership() public view override onlyOwner { revert RenounceDisabled(); }

    function getPolicy() external view returns (Policy memory) { return _policy; }
    function getRecipient(address recipient) external view returns (Recipient memory) { return _recipients[recipient]; }
    function getPending(uint256 pendingId) external view returns (Pending memory) { return _pendings[pendingId]; }
    function currentDay() public view returns (uint256) { return block.timestamp / 1 days; }
    function spentToday() public view returns (uint256) { return _spentDay == currentDay() ? _spentToday : 0; }
    function remainingDaily() external view returns (uint256) { uint256 s = spentToday(); return s >= _policy.dailyLimit ? 0 : _policy.dailyLimit - s; }
    function opsSpentToday() public view returns (uint256) { return _opsDay == currentDay() ? _opsSpentToday : 0; }
    function remainingOpsDaily() external view returns (uint256) { uint256 s = opsSpentToday(); return s >= _policy.opsDailyLimit ? 0 : _policy.opsDailyLimit - s; }

    function _checkCommon(bytes32 intentId, Action action, uint256 amount) internal returns (Outcome) {
        if (paused) return _violation(intentId, action, Reason.PAUSED, amount);
        if (amount == 0) return _violation(intentId, action, Reason.ZERO_AMOUNT, amount);
        if (usedIntent[intentId]) return _violation(intentId, action, Reason.DUPLICATE_INTENT, amount);
        return Outcome.EXECUTED;
    }
    function _violation(bytes32 intentId, Action action, Reason reason, uint256 amount) internal returns (Outcome) { emit PolicyViolation(intentId, action, reason, amount); return Outcome.BLOCKED; }
    function _rollDay() internal { uint256 d = currentDay(); if (_spentDay != d) { _spentDay = d; _spentToday = 0; } }
    function _rollOpsDay() internal { uint256 d = currentDay(); if (_opsDay != d) { _opsDay = d; _opsSpentToday = 0; } }
    function _validatePolicy(Policy memory p) internal pure {
        if (p.approvalThreshold == 0 || p.approvalThreshold > p.perTxLimit || p.perTxLimit > p.dailyLimit || p.opsPerCallLimit > p.opsDailyLimit || p.pendingExpiry == 0) revert InvalidPolicy();
    }
}
