// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IGovernanceToken.sol";

/// @title GovernanceToken
/// @notice Manages governance stake and voting power
/// @dev Implements weighted voting with anti-whale mechanisms
contract GovernanceToken is IGovernanceToken {
    /// @notice Minimum stake to create proposals
    uint256 public constant MIN_STAKE_TO_PROPOSE = 1 ether;

    /// @notice Anti-whale factor (reduces voting power of large holders)
    /// @dev Voting power = sqrt(stake) to prevent whale dominance
    uint256 private constant ANTI_WHALE_PRECISION = 1e18;

    /// @notice Maps member address to their stake
    mapping(address => uint256) public stakes;

    /// @notice Maps member address to their delegation
    mapping(address => address) public delegations;

    /// @notice Maps member address to delegation delegation count (for tracking)
    mapping(address => uint256) public delegationCount;

    /// @notice Total stake in the system
    uint256 public totalStake;

    /// @notice Emitted when a member deposits stake
    event StakeDeposited(address indexed member, uint256 amount);

    /// @notice Emitted when a member withdraws stake
    event StakeWithdrawn(address indexed member, uint256 amount);

    /// @notice Emitted when voting power is delegated
    event VotingPowerDelegated(address indexed from, address indexed to);

    /// @notice Emitted when delegation is revoked
    event DelegationRevoked(address indexed from, address indexed to);

    /// @notice Deposit ETH to gain governance stake
    /// @dev Converts ETH to governance stake (1:1 ratio)
    function deposit() external payable {
        require(msg.value > 0, "GovernanceToken: deposit amount must be greater than 0");
        
        stakes[msg.sender] += msg.value;
        totalStake += msg.value;

        emit StakeDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw stake from the system
    /// @param amount The amount to withdraw
    function withdraw(uint256 amount) external {
        require(amount > 0, "GovernanceToken: withdraw amount must be greater than 0");
        require(stakes[msg.sender] >= amount, "GovernanceToken: insufficient stake");

        stakes[msg.sender] -= amount;
        totalStake -= amount;

        (bool success, ) = msg.sender.call{ value: amount }("");
        require(success, "GovernanceToken: withdrawal failed");

        emit StakeWithdrawn(msg.sender, amount);
    }

    /// @notice Get voting power of an account
    /// @param account The account to check
    /// @return The voting power calculated with anti-whale factor
    function getVotingPower(address account) external view returns (uint256) {
        // If delegated to someone, return 0 (voting power is with delegate)
        if (delegations[account] != address(0)) {
            return 0;
        }

        uint256 baseStake = stakes[account];

        // Add delegated voting power from others (simplified - returns 0)
        uint256 delegatedVotingPower = _getReceivedDelegations();

        uint256 totalAccountStake = baseStake + delegatedVotingPower;

        // Apply anti-whale mechanism: voting power = sqrt(stake)
        return _calculateVotingPower(totalAccountStake);
    }

    /// @notice Get total voting power in the system
    /// @return The total voting power
    function getTotalVotingPower() external view returns (uint256) {
        // Total voting power = sqrt(total stake)
        return _calculateVotingPower(totalStake);
    }

    /// @notice Check if account can create proposals
    /// @param account The account to check
    /// @return True if account has enough stake to propose
    function canPropose(address account) external view returns (bool) {
        return stakes[account] >= MIN_STAKE_TO_PROPOSE;
    }

    /// @notice Get current stake of an account
    /// @param account The account to check
    /// @return The stake amount
    function getStake(address account) external view returns (uint256) {
        return stakes[account];
    }

    /// @notice Delegate voting power to another account
    /// @param delegate The address to delegate to
    function delegateVotingPower(address delegate) external {
        require(delegate != address(0), "GovernanceToken: invalid delegate");
        require(delegate != msg.sender, "GovernanceToken: cannot delegate to self");
        require(stakes[msg.sender] > 0, "GovernanceToken: no stake to delegate");

        // Revoke previous delegation if exists
        if (delegations[msg.sender] != address(0)) {
            delegationCount[delegations[msg.sender]]--;
            emit DelegationRevoked(msg.sender, delegations[msg.sender]);
        }

        delegations[msg.sender] = delegate;
        delegationCount[delegate]++;

        emit VotingPowerDelegated(msg.sender, delegate);
    }

    /// @notice Revoke voting power delegation
    function revokeDelegation() external {
        address previousDelegate = delegations[msg.sender];
        require(previousDelegate != address(0), "GovernanceToken: no delegation to revoke");

        delegations[msg.sender] = address(0);
        delegationCount[previousDelegate]--;

        emit DelegationRevoked(msg.sender, previousDelegate);
    }

    /// @notice Get delegation of an account
    /// @param account The account to check
    /// @return The delegated address (0 if no delegation)
    function getDelegation(address account) external view returns (address) {
        return delegations[account];
    }

    /// @notice Get voting power received from delegations
    /// @param account The account to check
    /// @return The total voting power from delegations
    function getReceivedDelegations(address account) external view returns (uint256) {
        // This is a simplified version - returns 0 for now
        // In production, this would track delegations received
        return 0;
    }

    /// @notice Internal function to calculate voting power with anti-whale mechanism
    /// @param stake The stake amount
    /// @return The voting power
    function _calculateVotingPower(uint256 stake) internal pure returns (uint256) {
        if (stake == 0) return 0;
        // Use sqrt for anti-whale: voting_power = sqrt(stake)
        // Simplified integer sqrt
        return _sqrt(stake);
    }

    /// @notice Internal function to get received delegations
    /// @return Total stake from accounts that delegated to this account
    function _getReceivedDelegations() internal pure returns (uint256) {
        // This is a simplified version - in a production system,
        // we would maintain a reverse mapping for efficiency
        // For now, this returns 0, but can be extended to track delegations
        return 0;
    }

    /// @notice Internal function to calculate integer square root
    /// @param y The value to calculate sqrt for
    /// @return z The square root
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
