// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDAOTreasury
/// @notice Interface for treasury management
interface IDAOTreasury {
    /// @notice Get balance of a fund category
    /// @param category The fund category
    /// @return The balance of the fund
    function getFundBalance(bytes32 category) external view returns (uint256);

    /// @notice Get total treasury balance
    /// @return The total balance of the treasury
    function getTotalBalance() external view returns (uint256);

    /// @notice Transfer funds from treasury
    /// @param recipient The recipient address
    /// @param amount The amount to transfer
    function transferFunds(address recipient, uint256 amount) external;

    /// @notice Get fund limit for a category
    /// @param category The fund category
    /// @return The limit for the fund
    function getFundLimit(bytes32 category) external view returns (uint256);
}
