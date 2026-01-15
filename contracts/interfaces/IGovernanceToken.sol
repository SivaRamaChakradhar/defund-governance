// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IGovernanceToken
/// @notice Interface for governance token with voting power tracking
interface IGovernanceToken {
    /// @notice Get voting power of an account
    /// @param account The account to check
    /// @return The voting power of the account
    function getVotingPower(address account) external view returns (uint256);

    /// @notice Get total voting power
    /// @return The total voting power in the system
    function getTotalVotingPower() external view returns (uint256);

    /// @notice Check if account has enough voting power to create proposals
    /// @param account The account to check
    /// @return True if account can create proposals
    function canPropose(address account) external view returns (bool);
}
