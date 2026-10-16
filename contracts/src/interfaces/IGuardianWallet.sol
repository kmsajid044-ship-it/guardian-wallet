// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGuardianWallet
/// @notice Types, events and errors of the GuardianWallet (SPEC.md §6). Shared by tests and the agent ABI.
interface IGuardianWallet {
    struct Policy {
        uint256 perTxLimit; // above this: blocked for agent
        uint256 dailyLimit; // agent outflow per UTC day
        uint256 approvalThreshold; // [threshold, perTxLimit] -> pending, needs owner
        uint64 recipientCooldown; // newly added recipient inactive for this long
        uint64 pendingExpiry; // pending actions expire after this long
        uint256 opsPerCallLimit;
        uint256 opsDailyLimit; // agent service spending per UTC day
    }

    struct Recipient {
        bool allowed;
        uint64 activeAfter;
        string label;
    }

    enum PendingStatus {
        NONE,
        PENDING,
        EXECUTED,
        REJECTED,
        EXPIRED
    }

    struct Pending {
        uint8 currency;
        address to;
        uint256 amount;
        bytes32 intentId;
        uint64 createdAt;
        uint64 expiresAt;
        PendingStatus status;
    }

    enum Outcome {
        EXECUTED,
        PENDING,
        BLOCKED
    }

    enum Action {
        PAY,
        REQUEST_APPROVAL,
        SAVE_TO_SAVINGS,
        PAY_SERVICE_FEE
    }

    /// @dev Checks run in the order documented on each agent function; the agent's
    ///      policy pre-check (agent/src/policy) mirrors this order exactly.
    enum Reason {
        PAUSED,
        ZERO_AMOUNT,
        DUPLICATE_INTENT,
        RECIPIENT_NOT_ALLOWED,
        RECIPIENT_NOT_ACTIVE,
        OVER_PER_TX_LIMIT,
        BELOW_APPROVAL_THRESHOLD,
        OVER_DAILY_LIMIT,
        INSUFFICIENT_BALANCE,
        OVER_OPS_PER_CALL,
        OVER_OPS_DAILY
    }

    // --------------------------------------------------------------- events

    /// @notice An agent action was refused by policy. Nothing moved. (CLAUDE.md rule 2: emit, don't revert.)
    event PolicyViolation(bytes32 indexed intentId, Action action, Reason reason, uint256 amount);
    event PaymentCompleted(bytes32 indexed intentId, uint8 indexed currency, address indexed to, uint256 amount);
    event ApprovalRequested(
        uint256 indexed pendingId, bytes32 indexed intentId, uint8 currency, address to, uint256 amount, uint64 expiresAt
    );
    event PendingApproved(uint256 indexed pendingId, bytes32 indexed intentId, address to, uint256 amount);
    event PendingRejected(uint256 indexed pendingId, bytes32 indexed intentId);
    event PendingExpired(uint256 indexed pendingId, bytes32 indexed intentId);
    event ServiceFeePaid(bytes32 indexed requestId, address indexed feeAccount, uint256 amount);
    event SavingsFunded(bytes32 indexed intentId, uint8 indexed currency, uint256 amount);

    event PolicyUpdated(Policy policy);
    event RecipientSet(address indexed recipient, bool allowed, uint64 activeAfter, string label);
    event FeeAccountSet(address indexed account);
    event AgentSet(address indexed previousAgent, address indexed newAgent);
    event GuardianSet(address indexed previousGuardian, address indexed newGuardian);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // --------------------------------------------------------------- errors

    error NotAgent();
    error NotOwnerOrGuardian();
    error ZeroAddress();
    error InvalidPolicy();
    error PendingNotActive(uint256 pendingId);
    error PendingHasExpired(uint256 pendingId);
    error PendingNotExpired(uint256 pendingId);
    error PendingNoLongerValid(uint256 pendingId, Reason reason);
    error RenounceDisabled();
}
