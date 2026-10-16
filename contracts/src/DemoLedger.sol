// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Simulated ledger for a research prototype. Balances are demo units identified by an ISO 4217
///         alphabetic code. They have no value, are not issued or redeemable, and are not money.
contract DemoLedger is Ownable {
    struct CurrencyInfo {
        bool listed;
        uint8 decimals;
        string name;
    }

    uint256 public constant RATE_BPS = 500;
    uint256 public constant YEAR = 365 days;
    uint8 public constant MAX_DECIMALS = 18;
    /// @notice Block timestamp units per second (1 on EVM chains, 1000 on FISCO BCOS); fixed at deployment.
    uint256 public immutable clockScale;
    address public controller;
    mapping(bytes3 => CurrencyInfo) public currencyInfo;
    bytes3[] private _codes;
    mapping(address => mapping(bytes3 => uint256)) private _balances;
    mapping(address => mapping(bytes3 => uint256)) private _savingsPrincipal;
    mapping(address => mapping(bytes3 => uint64)) private _savingsSince;

    event ControllerSet(address indexed controller);
    event CurrencyAdded(bytes3 indexed currency, uint8 decimals, string name);
    event DemoUnitsMinted(address indexed account, bytes3 indexed currency, uint256 amount);
    event BalanceMoved(address indexed from, address indexed to, bytes3 indexed currency, uint256 amount);
    event SavingsChanged(address indexed account, bytes3 indexed currency, uint256 available, uint256 savings);
    error NotController();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientSavings();
    error InvalidCurrency(bytes3 currency);
    error CurrencyAlreadyListed(bytes3 currency);
    error UnknownCurrency(bytes3 currency);

    // Seconds since 1970 stay below 1e11 until the year 5138; milliseconds passed it in 1973.
    uint256 private constant MILLISECOND_CLOCK_THRESHOLD = 100_000_000_000;

    constructor(address owner_) Ownable(owner_) { clockScale = block.timestamp >= MILLISECOND_CLOCK_THRESHOLD ? 1_000 : 1; }
    modifier onlyController() { if (msg.sender != controller) revert NotController(); _; }
    modifier listed(bytes3 currency) { if (!currencyInfo[currency].listed) revert UnknownCurrency(currency); _; }

    function setController(address controller_) external onlyOwner {
        if (controller_ == address(0)) revert ZeroAddress();
        controller = controller_;
        emit ControllerSet(controller_);
    }

    /// @notice Lists a demo unit by its ISO 4217 alphabetic code (three upper-case letters). Owner only;
    ///         listing never mints and cannot be undone, so existing balances stay addressable.
    function addCurrency(bytes3 currency, uint8 decimals, string calldata name) external onlyOwner {
        if (!_isCode(currency) || decimals > MAX_DECIMALS) revert InvalidCurrency(currency);
        if (currencyInfo[currency].listed) revert CurrencyAlreadyListed(currency);
        currencyInfo[currency] = CurrencyInfo(true, decimals, name);
        _codes.push(currency);
        emit CurrencyAdded(currency, decimals, name);
    }
    function currencies() external view returns (bytes3[] memory) { return _codes; }
    function isCurrency(bytes3 currency) external view returns (bool) { return currencyInfo[currency].listed; }

    function mint(address account, bytes3 currency, uint256 amount) external onlyOwner listed(currency) {
        if (account == address(0)) revert ZeroAddress();
        _balances[account][currency] += amount;
        emit DemoUnitsMinted(account, currency, amount);
    }
    function balanceOf(address account, bytes3 currency) external view returns (uint256) { return _balances[account][currency]; }
    function savingsBalance(address account, bytes3 currency) public view returns (uint256) {
        uint256 principal = _savingsPrincipal[account][currency];
        uint64 since = _savingsSince[account][currency];
        if (principal == 0 || since == 0) return principal;
        return principal + (principal * RATE_BPS * (_now() - since)) / (10_000 * YEAR);
    }
    function move(address from, address to, bytes3 currency, uint256 amount) external onlyController listed(currency) {
        if (to == address(0)) revert ZeroAddress();
        if (_balances[from][currency] < amount) revert InsufficientBalance();
        _balances[from][currency] -= amount;
        _balances[to][currency] += amount;
        emit BalanceMoved(from, to, currency, amount);
    }
    function save(address account, bytes3 currency, uint256 amount) external onlyController listed(currency) {
        if (_balances[account][currency] < amount) revert InsufficientBalance();
        _checkpoint(account, currency);
        _balances[account][currency] -= amount;
        _savingsPrincipal[account][currency] += amount;
        if (_savingsSince[account][currency] == 0) _savingsSince[account][currency] = uint64(_now());
        emit SavingsChanged(account, currency, _balances[account][currency], _savingsPrincipal[account][currency]);
    }
    function withdrawSavings(address account, bytes3 currency, uint256 amount) external onlyController listed(currency) {
        _checkpoint(account, currency);
        if (_savingsPrincipal[account][currency] < amount) revert InsufficientSavings();
        _savingsPrincipal[account][currency] -= amount;
        _balances[account][currency] += amount;
        emit SavingsChanged(account, currency, _balances[account][currency], _savingsPrincipal[account][currency]);
    }
    function _now() internal view returns (uint256) { return block.timestamp / clockScale; }
    function _isCode(bytes3 currency) internal pure returns (bool) {
        for (uint256 i; i < 3; i++) { bytes1 c = currency[i]; if (c < "A" || c > "Z") return false; }
        return true;
    }
    function _checkpoint(address account, bytes3 currency) internal {
        uint256 current = savingsBalance(account, currency);
        _savingsPrincipal[account][currency] = current;
        _savingsSince[account][currency] = current == 0 ? 0 : uint64(_now());
    }
}
