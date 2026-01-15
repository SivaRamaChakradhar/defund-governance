// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IGovernor
/// @notice Interface for governance and proposal management
interface IGovernor {
    enum ProposalState {
        Pending,
        Active,
        Defeated,
        Queued,
        Expired,
        Executed,
        Cancelled
    }

    enum ProposalType {
        HighConviction,
        ExperimentalBet,
        OperationalExpense
    }

    enum VoteType {
        For,
        Against,
        Abstain
    }

    /// @notice Create a new proposal
    /// @param recipient The address to receive funds
    /// @param amount The amount to transfer
    /// @param description The proposal description
    /// @param proposalType The type of proposal
    /// @return proposalId The ID of the created proposal
    function createProposal(
        address recipient,
        uint256 amount,
        string calldata description,
        ProposalType proposalType
    ) external returns (uint256);

    /// @notice Cast a vote on a proposal
    /// @param proposalId The proposal ID
    /// @param voteType The type of vote (For/Against/Abstain)
    function castVote(uint256 proposalId, VoteType voteType) external;

    /// @notice Delegate voting power
    /// @param delegate The address to delegate to
    function delegateVotingPower(address delegate) external;

    /// @notice Revoke voting power delegation
    function revokeDelegation() external;

    /// @notice Queue an approved proposal for execution
    /// @param proposalId The proposal ID
    function queueProposal(uint256 proposalId) external;

    /// @notice Execute a queued proposal
    /// @param proposalId The proposal ID
    function executeProposal(uint256 proposalId) external;

    /// @notice Cancel a proposal
    /// @param proposalId The proposal ID
    function cancelProposal(uint256 proposalId) external;

    /// @notice Get proposal state
    /// @param proposalId The proposal ID
    /// @return The current state of the proposal
    function getProposalState(uint256 proposalId) external view returns (ProposalState);
}
