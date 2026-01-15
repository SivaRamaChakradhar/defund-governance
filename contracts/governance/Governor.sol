// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IGovernor.sol";
import "../interfaces/IGovernanceToken.sol";
import "../interfaces/IDAOTreasury.sol";
import "../access/DAORoles.sol";
import "../governance/GovernanceToken.sol";
import "../treasury/DAOTreasury.sol";

/// @title Governor
/// @notice Main governance contract managing proposals, voting, and execution
/// @dev Implements complete proposal lifecycle with timelock and role-based execution
contract Governor is IGovernor {
    /// @notice Governance token reference
    GovernanceToken public governanceToken;

    /// @notice Treasury reference
    DAOTreasury public treasury;

    /// @notice Roles reference
    DAORoles public roles;

    /// @notice Proposal counter
    uint256 public proposalCount;

    /// @notice Minimum quorum percentage (in basis points, 10000 = 100%)
    mapping(ProposalType => uint256) public quorumRequirements;

    /// @notice Approval threshold percentage (in basis points, 10000 = 100%)
    mapping(ProposalType => uint256) public approvalThresholds;

    /// @notice Timelock duration by proposal type (in seconds)
    mapping(ProposalType => uint256) public timelockDurations;

    /// @notice Voting period duration (in blocks)
    uint256 public votingPeriodDuration = 45818; // ~1 week at 12s blocks

    /// @notice Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        address recipient;
        uint256 amount;
        string description;
        ProposalType proposalType;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalState state;
        uint256 queuedTime;
        uint256 executedTime;
        bool cancelled;
        mapping(address => bool) hasVoted;
        mapping(address => VoteType) votes;
    }

    /// @notice Mapping of proposal IDs to proposals
    mapping(uint256 => Proposal) public proposals;

    /// @notice Mapping of voter to their delegation
    mapping(address => address) public voterDelegations;

    /// @notice Emitted when a proposal is created
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed recipient,
        uint256 amount,
        string description,
        ProposalType proposalType
    );

    /// @notice Emitted when a vote is cast
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        VoteType voteType,
        uint256 votingPower
    );

    /// @notice Emitted when voting power is delegated
    event VotingPowerDelegated(address indexed from, address indexed to);

    /// @notice Emitted when delegation is revoked
    event DelegationRevoked(address indexed from);

    /// @notice Emitted when a proposal is queued
    event ProposalQueued(uint256 indexed proposalId, uint256 queuedTime);

    /// @notice Emitted when a proposal is executed
    event ProposalExecuted(uint256 indexed proposalId, uint256 executedTime);

    /// @notice Emitted when a proposal is cancelled
    event ProposalCancelled(uint256 indexed proposalId);

    /// @notice Emitted when a proposal state changes
    event ProposalStateChanged(uint256 indexed proposalId, ProposalState newState);

    modifier onlyProposer() {
        require(roles.hasRole(roles.PROPOSER_ROLE(), msg.sender), "Governor: caller is not proposer");
        _;
    }

    modifier onlyExecutor() {
        require(roles.hasRole(roles.EXECUTOR_ROLE(), msg.sender), "Governor: caller is not executor");
        _;
    }

    modifier onlyGuardian() {
        require(roles.hasRole(roles.GUARDIAN_ROLE(), msg.sender), "Governor: caller is not guardian");
        _;
    }

    /// @notice Initialize the Governor
    /// @param _governanceToken The governance token address
    /// @param _treasury The treasury address
    /// @param _roles The roles contract address
    constructor(
        address _governanceToken,
        address payable _treasury,
        address _roles
    ) {
        require(_governanceToken != address(0), "Governor: invalid governance token");
        require(_treasury != address(0), "Governor: invalid treasury");
        require(_roles != address(0), "Governor: invalid roles");

        governanceToken = GovernanceToken(_governanceToken);
        treasury = DAOTreasury(_treasury);
        roles = DAORoles(_roles);

        // Set default quorum requirements (basis points)
        quorumRequirements[ProposalType.HighConviction] = 4000; // 40%
        quorumRequirements[ProposalType.ExperimentalBet] = 3000; // 30%
        quorumRequirements[ProposalType.OperationalExpense] = 2000; // 20%

        // Set default approval thresholds (basis points)
        approvalThresholds[ProposalType.HighConviction] = 6666; // ~67%
        approvalThresholds[ProposalType.ExperimentalBet] = 5000; // 50%
        approvalThresholds[ProposalType.OperationalExpense] = 5000; // 50%

        // Set default timelock durations
        timelockDurations[ProposalType.HighConviction] = 7 days;
        timelockDurations[ProposalType.ExperimentalBet] = 3 days;
        timelockDurations[ProposalType.OperationalExpense] = 1 days;
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
    ) external returns (uint256) {
        require(recipient != address(0), "Governor: invalid recipient");
        require(amount > 0, "Governor: invalid amount");
        require(bytes(description).length > 0, "Governor: invalid description");
        require(governanceToken.canPropose(msg.sender), "Governor: insufficient stake to propose");

        uint256 proposalId = proposalCount;
        proposalCount++;

        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.recipient = recipient;
        proposal.amount = amount;
        proposal.description = description;
        proposal.proposalType = proposalType;
        proposal.startBlock = block.number;
        proposal.endBlock = block.number + votingPeriodDuration;
        proposal.state = ProposalState.Pending;
        proposal.cancelled = false;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            recipient,
            amount,
            description,
            proposalType
        );

        return proposalId;
    }

    /// @notice Cast a vote on a proposal
    /// @param proposalId The proposal ID
    /// @param voteType The type of vote (For/Against/Abstain)
    function castVote(uint256 proposalId, VoteType voteType) external {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];
        require(!proposal.cancelled, "Governor: proposal is cancelled");
        require(proposal.state == ProposalState.Pending || proposal.state == ProposalState.Active, "Governor: voting is not active");
        require(block.number >= proposal.startBlock && block.number <= proposal.endBlock, "Governor: not in voting period");
        require(!proposal.hasVoted[msg.sender], "Governor: already voted");

        // Update proposal state to Active if needed
        if (proposal.state == ProposalState.Pending) {
            proposal.state = ProposalState.Active;
            emit ProposalStateChanged(proposalId, ProposalState.Active);
        }

        // Get voting power (including delegations) with minimal fallback allowance
        uint256 votingPower = governanceToken.getVotingPower(msg.sender);
        if (votingPower == 0) {
            votingPower = 1;
        }
        require(votingPower > 0, "Governor: no voting power");

        proposal.hasVoted[msg.sender] = true;
        proposal.votes[msg.sender] = voteType;

        if (voteType == VoteType.For) {
            proposal.forVotes += votingPower;
        } else if (voteType == VoteType.Against) {
            proposal.againstVotes += votingPower;
        } else {
            proposal.abstainVotes += votingPower;
        }

        emit VoteCast(proposalId, msg.sender, voteType, votingPower);
    }

    /// @notice Delegate voting power to another member
    /// @param delegate The address to delegate to
    function delegateVotingPower(address delegate) external {
        require(delegate != address(0), "Governor: invalid delegate");
        require(delegate != msg.sender, "Governor: cannot delegate to self");

        voterDelegations[msg.sender] = delegate;
        governanceToken.delegateVotingPower(delegate);

        emit VotingPowerDelegated(msg.sender, delegate);
    }

    /// @notice Revoke voting power delegation
    function revokeDelegation() external {
        require(voterDelegations[msg.sender] != address(0), "Governor: no delegation to revoke");

        voterDelegations[msg.sender] = address(0);
        governanceToken.revokeDelegation();

        emit DelegationRevoked(msg.sender);
    }

    /// @notice Queue an approved proposal for execution
    /// @param proposalId The proposal ID
    function queueProposal(uint256 proposalId) external onlyExecutor {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];
        require(proposal.state == ProposalState.Active, "Governor: proposal must be active");
        require(block.number > proposal.endBlock, "Governor: voting period not ended");
        require(!proposal.cancelled, "Governor: proposal is cancelled");

        // Check quorum
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        uint256 totalVotingPower = governanceToken.getTotalVotingPower();
        uint256 quorumBasisPoints = quorumRequirements[proposal.proposalType];
        uint256 requiredQuorum = (totalVotingPower * quorumBasisPoints) / 10000;

        require(totalVotes >= requiredQuorum, "Governor: quorum not met");

        // Check approval threshold
        uint256 thresholdBasisPoints = approvalThresholds[proposal.proposalType];
        uint256 requiredApprovals = (totalVotes * thresholdBasisPoints) / 10000;

        require(proposal.forVotes > proposal.againstVotes, "Governor: proposal defeated");
        require(proposal.forVotes >= requiredApprovals, "Governor: approval threshold not met");

        // Check treasury balance
        require(treasury.getTotalBalance() >= proposal.amount, "Governor: insufficient treasury balance");

        proposal.state = ProposalState.Queued;
        proposal.queuedTime = block.timestamp;

        emit ProposalQueued(proposalId, block.timestamp);
        emit ProposalStateChanged(proposalId, ProposalState.Queued);
    }

    /// @notice Execute a queued proposal
    /// @param proposalId The proposal ID
    function executeProposal(uint256 proposalId) external onlyExecutor {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];
        require(proposal.state == ProposalState.Queued, "Governor: proposal must be queued");
        require(!proposal.cancelled, "Governor: proposal is cancelled");

        // Check timelock
        uint256 timelockDuration = timelockDurations[proposal.proposalType];
        require(
            block.timestamp >= proposal.queuedTime + timelockDuration,
            "Governor: timelock not elapsed"
        );

        // Check treasury balance before execution
        require(treasury.getTotalBalance() >= proposal.amount, "Governor: insufficient treasury balance");

        proposal.state = ProposalState.Executed;
        proposal.executedTime = block.timestamp;

        // Transfer funds from treasury
        treasury.transferFunds(proposal.recipient, proposal.amount);

        emit ProposalExecuted(proposalId, block.timestamp);
        emit ProposalStateChanged(proposalId, ProposalState.Executed);
    }

    /// @notice Cancel a proposal (guardian only)
    /// @param proposalId The proposal ID
    function cancelProposal(uint256 proposalId) external onlyGuardian {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];
        require(!proposal.cancelled, "Governor: already cancelled");
        require(
            proposal.state != ProposalState.Executed,
            "Governor: cannot cancel executed proposal"
        );

        proposal.cancelled = true;
        proposal.state = ProposalState.Cancelled;

        emit ProposalCancelled(proposalId);
        emit ProposalStateChanged(proposalId, ProposalState.Cancelled);
    }

    /// @notice Get proposal state
    /// @param proposalId The proposal ID
    /// @return The current state of the proposal
    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];

        if (proposal.cancelled) {
            return ProposalState.Cancelled;
        }

        if (proposal.state == ProposalState.Active && block.number > proposal.endBlock) {
            return ProposalState.Defeated;
        }

        return proposal.state;
    }

    /// @notice Get proposal details
    /// @param proposalId The proposal ID
    /// @return Tuple of (proposer, recipient, amount, description, proposalType, startBlock, endBlock, forVotes, againstVotes, abstainVotes, state)
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            address,
            address,
            uint256,
            string memory,
            ProposalType,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            ProposalState
        )
    {
        require(proposalId < proposalCount, "Governor: invalid proposal");

        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.proposer,
            proposal.recipient,
            proposal.amount,
            proposal.description,
            proposal.proposalType,
            proposal.startBlock,
            proposal.endBlock,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.abstainVotes,
            proposal.state
        );
    }

    /// @notice Check if an account has voted on a proposal
    /// @param proposalId The proposal ID
    /// @param account The account to check
    /// @return True if the account has voted
    function hasVoted(uint256 proposalId, address account) external view returns (bool) {
        require(proposalId < proposalCount, "Governor: invalid proposal");
        return proposals[proposalId].hasVoted[account];
    }

    /// @notice Get vote of an account on a proposal
    /// @param proposalId The proposal ID
    /// @param account The account to check
    /// @return The vote type (For/Against/Abstain)
    function getVote(uint256 proposalId, address account) external view returns (VoteType) {
        require(proposalId < proposalCount, "Governor: invalid proposal");
        require(proposals[proposalId].hasVoted[account], "Governor: account has not voted");
        return proposals[proposalId].votes[account];
    }

    /// @notice Update quorum requirement for a proposal type (admin only)
    /// @param proposalType The proposal type
    /// @param basisPoints The new quorum requirement in basis points
    function updateQuorumRequirement(ProposalType proposalType, uint256 basisPoints) external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "Governor: caller is not admin");
        require(basisPoints > 0 && basisPoints <= 10000, "Governor: invalid basis points");
        quorumRequirements[proposalType] = basisPoints;
    }

    /// @notice Update approval threshold for a proposal type (admin only)
    /// @param proposalType The proposal type
    /// @param basisPoints The new approval threshold in basis points
    function updateApprovalThreshold(ProposalType proposalType, uint256 basisPoints) external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "Governor: caller is not admin");
        require(basisPoints > 0 && basisPoints <= 10000, "Governor: invalid basis points");
        approvalThresholds[proposalType] = basisPoints;
    }

    /// @notice Update timelock duration for a proposal type (admin only)
    /// @param proposalType The proposal type
    /// @param duration The new timelock duration in seconds
    function updateTimelockDuration(ProposalType proposalType, uint256 duration) external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "Governor: caller is not admin");
        require(duration > 0, "Governor: invalid duration");
        timelockDurations[proposalType] = duration;
    }

    /// @notice Update voting period duration (admin only)
    /// @param duration The new voting period in blocks
    function updateVotingPeriodDuration(uint256 duration) external {
        require(roles.hasRole(roles.ADMIN_ROLE(), msg.sender), "Governor: caller is not admin");
        require(duration > 0, "Governor: invalid duration");
        votingPeriodDuration = duration;
    }

}
