// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IDAOTreasury.sol";
import "../access/DAORoles.sol";

/// @title DAOTreasury
/// @notice Manages DAO treasury with fund categories and limits
/// @dev Implements multi-tier fund management with different rules per category
contract DAOTreasury is IDAOTreasury {
    /// @notice Fund category identifiers
    bytes32 public constant CATEGORY_HIGH_CONVICTION = keccak256("HIGH_CONVICTION");
    bytes32 public constant CATEGORY_EXPERIMENTAL = keccak256("EXPERIMENTAL");
    bytes32 public constant CATEGORY_OPERATIONAL = keccak256("OPERATIONAL");

    /// @notice Reference to the roles contract
    DAORoles public roles;

    /// @notice Fund balances by category
    mapping(bytes32 => uint256) public fundBalances;

    /// @notice Fund limits by category (maximum balance)
    mapping(bytes32 => uint256) public fundLimits;

    /// @notice Emergency pause state
    bool public paused;

    /// @notice Total treasury balance
    uint256 public totalBalance;

    /// @notice Emitted when funds are transferred
    event FundsTransferred(address indexed recipient, uint256 amount, bytes32 indexed category);

    /// @notice Emitted when a fund category is updated
    event FundCategoryUpdated(bytes32 indexed category, uint256 limit);

    /// @notice Emitted when emergency pause is activated
    event EmergencyPauseActivated();

    /// @notice Emitted when system is resumed
    event SystemResumed();

    modifier notPaused() {
        require(!paused, "DAOTreasury: system is paused");
        _;
    }

    modifier onlyExecutor() {
        require(roles.hasRole(roles.EXECUTOR_ROLE(), msg.sender), "DAOTreasury: caller is not executor");
        _;
    }

    modifier onlyGuardian() {
        require(roles.hasRole(roles.GUARDIAN_ROLE(), msg.sender), "DAOTreasury: caller is not guardian");
        _;
    }

    /// @notice Initialize treasury with roles and fund limits
    /// @param _rolesAddress The address of the DAORoles contract
    constructor(address _rolesAddress) {
        require(_rolesAddress != address(0), "DAOTreasury: invalid roles address");
        
        roles = DAORoles(_rolesAddress);

        // Set default fund limits
        fundLimits[CATEGORY_HIGH_CONVICTION] = 500 ether;
        fundLimits[CATEGORY_EXPERIMENTAL] = 100 ether;
        fundLimits[CATEGORY_OPERATIONAL] = 50 ether;
    }

    /// @notice Receive ETH into the treasury
    receive() external payable {
        totalBalance += msg.value;
        // Default to operational expenses for direct deposits
        fundBalances[CATEGORY_OPERATIONAL] += msg.value;
    }

    /// @notice Get balance of a fund category
    /// @param category The fund category
    /// @return The balance of the fund
    function getFundBalance(bytes32 category) external view returns (uint256) {
        return fundBalances[category];
    }

    /// @notice Get total treasury balance
    /// @return The total balance of the treasury
    function getTotalBalance() external view returns (uint256) {
        return totalBalance;
    }

    /// @notice Transfer funds from treasury
    /// @param recipient The recipient address
    /// @param amount The amount to transfer
    function transferFunds(address recipient, uint256 amount) external onlyExecutor notPaused {
        require(recipient != address(0), "DAOTreasury: invalid recipient");
        require(amount > 0, "DAOTreasury: invalid amount");
        require(totalBalance >= amount, "DAOTreasury: insufficient treasury balance");

        totalBalance -= amount;

        // Deduct from operational category first, then others
        if (fundBalances[CATEGORY_OPERATIONAL] >= amount) {
            fundBalances[CATEGORY_OPERATIONAL] -= amount;
        } else {
            uint256 remaining = amount;
            
            if (fundBalances[CATEGORY_OPERATIONAL] > 0) {
                remaining -= fundBalances[CATEGORY_OPERATIONAL];
                fundBalances[CATEGORY_OPERATIONAL] = 0;
            }

            if (fundBalances[CATEGORY_EXPERIMENTAL] >= remaining) {
                fundBalances[CATEGORY_EXPERIMENTAL] -= remaining;
            } else if (fundBalances[CATEGORY_EXPERIMENTAL] > 0) {
                remaining -= fundBalances[CATEGORY_EXPERIMENTAL];
                fundBalances[CATEGORY_EXPERIMENTAL] = 0;
                
                if (fundBalances[CATEGORY_HIGH_CONVICTION] >= remaining) {
                    fundBalances[CATEGORY_HIGH_CONVICTION] -= remaining;
                } else {
                    revert("DAOTreasury: inconsistent fund balances");
                }
            } else if (fundBalances[CATEGORY_HIGH_CONVICTION] >= remaining) {
                fundBalances[CATEGORY_HIGH_CONVICTION] -= remaining;
            } else {
                revert("DAOTreasury: inconsistent fund balances");
            }
        }

        (bool success, ) = recipient.call{ value: amount }("");
        require(success, "DAOTreasury: transfer failed");

        emit FundsTransferred(recipient, amount, CATEGORY_OPERATIONAL);
    }

    /// @notice Get fund limit for a category
    /// @param category The fund category
    /// @return The limit for the fund
    function getFundLimit(bytes32 category) external view returns (uint256) {
        return fundLimits[category];
    }

    /// @notice Update fund limit for a category (admin only)
    /// @param category The fund category
    /// @param limit The new limit
    function updateFundLimit(bytes32 category, uint256 limit) external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "DAOTreasury: caller is not admin");
        require(limit > 0, "DAOTreasury: invalid limit");

        fundLimits[category] = limit;
        emit FundCategoryUpdated(category, limit);
    }

    /// @notice Allocate funds to a category
    /// @param category The fund category
    /// @param amount The amount to allocate
    function allocateFunds(bytes32 category, uint256 amount) external {
        require(roles.hasRole(roles.EXECUTOR_ROLE(), msg.sender), "DAOTreasury: caller is not executor");
        require(amount > 0, "DAOTreasury: invalid amount");
        require(fundBalances[CATEGORY_OPERATIONAL] >= amount, "DAOTreasury: insufficient operational balance");

        fundBalances[CATEGORY_OPERATIONAL] -= amount;
        fundBalances[category] += amount;

        require(fundBalances[category] <= fundLimits[category], "DAOTreasury: category limit exceeded");
    }

    /// @notice Emergency pause function (guardian only)
    function emergencyPause() external onlyGuardian {
        require(!paused, "DAOTreasury: already paused");
        paused = true;
        emit EmergencyPauseActivated();
    }

    /// @notice Resume system after emergency pause (admin only)
    function resumeSystem() external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "DAOTreasury: caller is not admin");
        require(paused, "DAOTreasury: system is not paused");
        paused = false;
        emit SystemResumed();
    }
}
