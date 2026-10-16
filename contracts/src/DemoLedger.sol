// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Simulated ledger for a research prototype. No real money is represented.
contract DemoLedger is Ownable {
    enum Currency { USD, BDT }
    uint256 public constant RATE_BPS = 500;
    uint256 public constant YEAR = 365 days;
    address public controller;
    mapping(address => mapping(Currency => uint256)) private _balances;
    mapping(address => mapping(Currency => uint256)) private _savingsPrincipal;
    mapping(address => mapping(Currency => uint64)) private _savingsSince;

    event ControllerSet(address indexed controller);
    event DemoUnitsMinted(address indexed account, Currency indexed currency, uint256 amount);
    event BalanceMoved(address indexed from, address indexed to, Currency indexed currency, uint256 amount);
    event SavingsChanged(address indexed account, Currency indexed currency, uint256 available, uint256 savings);
    error NotController();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientSavings();

    constructor(address owner_) Ownable(owner_) {}
    modifier onlyController() { if (msg.sender != controller) revert NotController(); _; }

    function setController(address controller_) external onlyOwner {
        if (controller_ == address(0)) revert ZeroAddress();
        controller = controller_;
        emit ControllerSet(controller_);
    }
    function mint(address account, Currency currency, uint256 amount) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _balances[account][currency] += amount;
        emit DemoUnitsMinted(account, currency, amount);
    }
    function balanceOf(address account, Currency currency) external view returns (uint256) { return _balances[account][currency]; }
    function savingsBalance(address account, Currency currency) public view returns (uint256) {
        uint256 principal = _savingsPrincipal[account][currency];
        uint64 since = _savingsSince[account][currency];
        if (principal == 0 || since == 0) return principal;
        return principal + (principal * RATE_BPS * (block.timestamp - since)) / (10_000 * YEAR);
    }
    function move(address from, address to, Currency currency, uint256 amount) external onlyController {
        if (to == address(0)) revert ZeroAddress();
        if (_balances[from][currency] < amount) revert InsufficientBalance();
        _balances[from][currency] -= amount;
        _balances[to][currency] += amount;
        emit BalanceMoved(from, to, currency, amount);
    }
    function save(address account, Currency currency, uint256 amount) external onlyController {
        if (_balances[account][currency] < amount) revert InsufficientBalance();
        _checkpoint(account, currency);
        _balances[account][currency] -= amount;
        _savingsPrincipal[account][currency] += amount;
        if (_savingsSince[account][currency] == 0) _savingsSince[account][currency] = uint64(block.timestamp);
        emit SavingsChanged(account, currency, _balances[account][currency], _savingsPrincipal[account][currency]);
    }
    function withdrawSavings(address account, Currency currency, uint256 amount) external onlyController {
        _checkpoint(account, currency);
        if (_savingsPrincipal[account][currency] < amount) revert InsufficientSavings();
        _savingsPrincipal[account][currency] -= amount;
        _balances[account][currency] += amount;
        emit SavingsChanged(account, currency, _balances[account][currency], _savingsPrincipal[account][currency]);
    }
    function _checkpoint(address account, Currency currency) internal {
        uint256 current = savingsBalance(account, currency);
        _savingsPrincipal[account][currency] = current;
        _savingsSince[account][currency] = current == 0 ? 0 : uint64(block.timestamp);
    }
}
