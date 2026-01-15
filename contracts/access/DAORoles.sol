// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DAORoles
/// @notice Manages role-based access control for the DAO
/// @dev Implements multiple roles with clear separation of powers
contract DAORoles {
    /// @notice Role identifiers
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant VOTER_ROLE = keccak256("VOTER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Role assignments mapping
    mapping(bytes32 => mapping(address => bool)) private roles;

    /// @notice Stores members and their roles for querying
    mapping(address => bytes32[]) private memberRoles;
    address[] private allMembers;

    /// @notice Emitted when a role is granted
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /// @notice Emitted when a role is revoked
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /// @notice Emitted when a member is added to the system
    event MemberAdded(address indexed member);

    /// @notice Emitted when a member is removed from the system
    event MemberRemoved(address indexed member);

    modifier onlyRole(bytes32 role) {
        require(hasRole(role, msg.sender), "DAORoles: insufficient permissions");
        _;
    }

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "DAORoles: caller is not admin");
        _;
    }

    constructor() {
        _grantRole(ADMIN_ROLE, msg.sender);
        _addMember(msg.sender);
    }

    /// @notice Check if an account has a role
    /// @param role The role identifier
    /// @param account The account to check
    /// @return True if the account has the role
    function hasRole(bytes32 role, address account) public view returns (bool) {
        return roles[role][account];
    }

    /// @notice Grant a role to an account
    /// @param role The role identifier
    /// @param account The account to grant the role to
    function grantRole(bytes32 role, address account) external onlyAdmin {
        _grantRole(role, account);
    }

    /// @notice Revoke a role from an account
    /// @param role The role identifier
    /// @param account The account to revoke the role from
    function revokeRole(bytes32 role, address account) external onlyAdmin {
        _revokeRole(role, account);
    }

    /// @notice Renounce a role
    /// @param role The role to renounce
    function renounceRole(bytes32 role) external {
        require(roles[role][msg.sender], "DAORoles: you do not have this role");
        _revokeRole(role, msg.sender);
    }

    /// @notice Get all members in the DAO
    /// @return Array of all member addresses
    function getAllMembers() external view returns (address[] memory) {
        return allMembers;
    }

    /// @notice Get all roles of a member
    /// @param member The member address
    /// @return Array of role identifiers
    function getMemberRoles(address member) external view returns (bytes32[] memory) {
        return memberRoles[member];
    }

    /// @notice Internal function to grant a role
    /// @param role The role identifier
    /// @param account The account to grant the role to
    function _grantRole(bytes32 role, address account) internal {
        if (!roles[role][account]) {
            roles[role][account] = true;
            memberRoles[account].push(role);
            _addMember(account);
            emit RoleGranted(role, account, msg.sender);
        }
    }

    /// @notice Internal function to revoke a role
    /// @param role The role identifier
    /// @param account The account to revoke the role from
    function _revokeRole(bytes32 role, address account) internal {
        if (roles[role][account]) {
            roles[role][account] = false;
            
            // Remove from memberRoles array
            bytes32[] storage roles_ = memberRoles[account];
            for (uint256 i = 0; i < roles_.length; i++) {
                if (roles_[i] == role) {
                    roles_[i] = roles_[roles_.length - 1];
                    roles_.pop();
                    break;
                }
            }
            
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    /// @notice Internal function to add a member
    /// @param member The member address
    function _addMember(address member) internal {
        bool exists = false;
        for (uint256 i = 0; i < allMembers.length; i++) {
            if (allMembers[i] == member) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            allMembers.push(member);
            emit MemberAdded(member);
        }
    }
}
