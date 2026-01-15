import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Governor - Proposal Lifecycle and Timelock", () => {
  let daoRoles: any;
  let governanceToken: any;
  let treasury: any;
  let governor: any;
  let deployer: SignerWithAddress;
  let member1: SignerWithAddress;
  let member2: SignerWithAddress;
  let member3: SignerWithAddress;
  let member4: SignerWithAddress;

  async function setupProposal() {
    const proposalId = 0;
    await governor.connect(member1).createProposal(member2.address, ethers.parseEther("10"), "Test", 0);

    // Get sufficient votes
    await governor.connect(member1).castVote(proposalId, 0);
    await governor.connect(member2).castVote(proposalId, 0);
    await governor.connect(member3).castVote(proposalId, 0);

    // Mine blocks to end voting
    const votingPeriodDuration = await governor.votingPeriodDuration();
    for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
      await ethers.provider.send("hardhat_mine", ["1"]);
    }

    return proposalId;
  }

  beforeEach(async () => {
    [deployer, member1, member2, member3, member4] = await ethers.getSigners();

    const DAORoles = await ethers.getContractFactory("DAORoles");
    daoRoles = await DAORoles.deploy();
    await daoRoles.waitForDeployment();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceToken.deploy();
    await governanceToken.waitForDeployment();

    const DAOTreasury = await ethers.getContractFactory("DAOTreasury");
    treasury = await DAOTreasury.deploy(await daoRoles.getAddress());
    await treasury.waitForDeployment();

    const Governor = await ethers.getContractFactory("Governor");
    governor = await Governor.deploy(
      await governanceToken.getAddress(),
      await treasury.getAddress(),
      await daoRoles.getAddress()
    );
    await governor.waitForDeployment();

    const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
    const VOTER_ROLE = await daoRoles.VOTER_ROLE();
    const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();
    const GUARDIAN_ROLE = await daoRoles.GUARDIAN_ROLE();

    for (const member of [deployer, member1, member2, member3, member4]) {
      await daoRoles.grantRole(PROPOSER_ROLE, member.address);
      await daoRoles.grantRole(VOTER_ROLE, member.address);
      await daoRoles.grantRole(EXECUTOR_ROLE, member.address);
      await daoRoles.grantRole(GUARDIAN_ROLE, member.address);
    }

    await governanceToken.connect(deployer).deposit({ value: ethers.parseEther("100") });
    await governanceToken.connect(member1).deposit({ value: ethers.parseEther("50") });
    await governanceToken.connect(member2).deposit({ value: ethers.parseEther("30") });
    await governanceToken.connect(member3).deposit({ value: ethers.parseEther("20") });
    await governanceToken.connect(member4).deposit({ value: ethers.parseEther("10") });

    await deployer.sendTransaction({
      to: await treasury.getAddress(),
      value: ethers.parseEther("500"),
    });
  });

  describe("Proposal Lifecycle", () => {
    it("R6: Proposals go through complete lifecycle: Draft/Pending -> Active -> Queued -> Executed", async () => {
      const proposalId = 0;

      // Pending state
      await governor.connect(member1).createProposal(member2.address, ethers.parseEther("10"), "Test", 0);
      let state = await governor.getProposalState(proposalId);
      expect(state).to.equal(0); // Pending

      // Active state (when voting starts)
      await governor.connect(member1).castVote(proposalId, 0);
      state = await governor.getProposalState(proposalId);
      expect(state).to.equal(1); // Active

      // Ensure approval
      await governor.connect(member2).castVote(proposalId, 0);
      await governor.connect(member3).castVote(proposalId, 0);

      // Mine blocks to end voting
      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      // Queue state
      await governor.connect(member1).queueProposal(proposalId);
      state = await governor.getProposalState(proposalId);
      expect(state).to.equal(3); // Queued

      // Skip timelock
      const timelockDuration = await governor.timelockDurations(0); // HighConviction
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) + 1]);
      await ethers.provider.send("evm_mine");

      // Executed state
      await governor.connect(member1).executeProposal(proposalId);
      state = await governor.getProposalState(proposalId);
      expect(state).to.equal(5); // Executed
    });

    it("R27: Proposal state queryable at any time", async () => {
      const proposalId = 0;
      await governor.connect(member1).createProposal(member2.address, ethers.parseEther("10"), "Test", 0);

      // Can query at any time
      const state1 = await governor.getProposalState(proposalId);
      expect(state1).to.equal(0);

      await governor.connect(member1).castVote(proposalId, 0);
      const state2 = await governor.getProposalState(proposalId);
      expect(state2).to.equal(1);

      // Can query multiple times
      const state3 = await governor.getProposalState(proposalId);
      expect(state3).to.equal(1);
    });

    it("R22: Proposals not meeting approval threshold cannot be queued", async () => {
      const proposalId = 0;
      await governor.connect(member1).createProposal(member4.address, ethers.parseEther("1"), "Proposal", 2); // Operational

      // Vote against
      await governor.connect(member1).castVote(proposalId, 1); // Against

      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      await expect(
        governor.connect(member2).queueProposal(proposalId)
      ).to.be.revertedWith("Governor: proposal defeated");
    });

    it("R28: Handle edge cases - proposals with zero votes", async () => {
      const proposalId = 0;
      await governor.connect(member1).createProposal(member2.address, ethers.parseEther("1"), "No votes", 2);

      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      // Should not be able to queue without votes
      await expect(
        governor.connect(member2).queueProposal(proposalId)
      ).to.be.revertedWith("Governor: quorum not met");
    });

    it("R28: Handle edge cases - ties in voting results", async () => {
      const proposalId = 0;
      await governor.connect(member1).createProposal(member4.address, ethers.parseEther("1"), "Tied", 2);

      // Create a tie
      await governor.connect(member1).castVote(proposalId, 0); // For
      await governor.connect(member2).castVote(proposalId, 1); // Against

      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      // Tie should be defeated (against votes are not less than for votes)
      await expect(
        governor.connect(member3).queueProposal(proposalId)
      ).to.be.revertedWith("Governor: proposal defeated");
    });

    it("R28: Handle edge cases - proposals that expire without reaching quorum", async () => {
      const proposalId = 0;
      await governor.connect(member1).createProposal(member2.address, ethers.parseEther("1"), "Low participation", 0);

      // Only one vote
      await governor.connect(member1).castVote(proposalId, 0);

      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      // Should fail due to quorum
      await expect(
        governor.connect(member2).queueProposal(proposalId)
      ).to.be.revertedWith("Governor: quorum not met");
    });
  });

  describe("Timelock", () => {
    it("R7: Approved proposals cannot be executed immediately", async () => {
      const proposalId = await setupProposal();

      // Queue it
      await governor.connect(member1).queueProposal(proposalId);

      // Try to execute immediately
      await expect(
        governor.connect(member1).executeProposal(proposalId)
      ).to.be.revertedWith("Governor: timelock not elapsed");
    });

    it("R8: Timelock duration is configurable per proposal type", async () => {
      const hcTimelock = await governor.timelockDurations(0);
      const ebTimelock = await governor.timelockDurations(1);
      const opTimelock = await governor.timelockDurations(2);

      expect(hcTimelock).to.not.equal(ebTimelock);
      expect(ebTimelock).to.not.equal(opTimelock);

      console.log(`  High Conviction timelock: ${hcTimelock} seconds (7 days)`);
      console.log(`  Experimental Bet timelock: ${ebTimelock} seconds (3 days)`);
      console.log(`  Operational timelock: ${opTimelock} seconds (1 day)`);
    });

    it("R9: Mechanism to cancel queued proposal during timelock period", async () => {
      const proposalId = await setupProposal();

      // Queue it
      await governor.connect(member1).queueProposal(proposalId);
      let state = await governor.getProposalState(proposalId);
      expect(state).to.equal(3); // Queued

      // Cancel it
      await governor.connect(deployer).cancelProposal(proposalId);
      state = await governor.getProposalState(proposalId);
      expect(state).to.equal(6); // Cancelled
    });

    it("R29: Timelock duration enforced correctly", async () => {
      const proposalId = await setupProposal();

      await governor.connect(member1).queueProposal(proposalId);
      const queuedTime = await ethers.provider.getBlock("latest");
      const timelockDuration = await governor.timelockDurations(0);

      // Try to execute before timelock
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) - 100]);
      await ethers.provider.send("evm_mine");

      await expect(
        governor.connect(member1).executeProposal(proposalId)
      ).to.be.revertedWith("Governor: timelock not elapsed");

      // Execute after timelock
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      await expect(governor.connect(member1).executeProposal(proposalId))
        .to.emit(governor, "ProposalExecuted");
    });

    it("R10: Only authorized roles can execute queued proposals", async () => {
      const proposalId = await setupProposal();

      await governor.connect(member1).queueProposal(proposalId);

      const timelockDuration = await governor.timelockDurations(0);
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) + 1]);
      await ethers.provider.send("evm_mine");

      // Non-executor cannot execute
      await expect(
        governor.connect(member4).executeProposal(proposalId)
      ).to.be.revertedWith("Governor: caller is not executor");

      // Executor can execute
      await expect(governor.connect(member1).executeProposal(proposalId))
        .to.emit(governor, "ProposalExecuted");
    });

    it("R10: Execution transfers proposed amount to recipient", async () => {
      const recipientBalance = await ethers.provider.getBalance(member2.address);
      const amount = ethers.parseEther("10");

      const proposalId = 0;
      await governor.connect(member1).createProposal(member2.address, amount, "Test", 0);
      await governor.connect(member1).castVote(proposalId, 0);
      await governor.connect(member2).castVote(proposalId, 0);
      await governor.connect(member3).castVote(proposalId, 0);

      const votingPeriodDuration = await governor.votingPeriodDuration();
      for (let i = 0n; i < votingPeriodDuration + 10n; i++) {
        await ethers.provider.send("hardhat_mine", ["1"]);
      }

      await governor.connect(member1).queueProposal(proposalId);

      const timelockDuration = await governor.timelockDurations(0);
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) + 1]);
      await ethers.provider.send("evm_mine");

      await governor.connect(member1).executeProposal(proposalId);

      const newBalance = await ethers.provider.getBalance(member2.address);
      expect(newBalance).to.equal(recipientBalance + amount);
    });

    it("R11: System prevents same proposal from being executed multiple times", async () => {
      const proposalId = await setupProposal();

      await governor.connect(member1).queueProposal(proposalId);

      const timelockDuration = await governor.timelockDurations(0);
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) + 1]);
      await ethers.provider.send("evm_mine");

      // First execution
      await governor.connect(member1).executeProposal(proposalId);

      // Try to execute again
      await expect(
        governor.connect(member1).executeProposal(proposalId)
      ).to.be.revertedWith("Governor: proposal must be queued");
    });
  });

  describe("Proposal Cancellation", () => {
    it("R9: Guardian can cancel proposals during timelock", async () => {
      const proposalId = await setupProposal();

      await governor.connect(member1).queueProposal(proposalId);

      // Cancel as guardian
      await expect(governor.connect(deployer).cancelProposal(proposalId))
        .to.emit(governor, "ProposalCancelled");

      const state = await governor.getProposalState(proposalId);
      expect(state).to.equal(6); // Cancelled
    });

    it("R9: Cannot cancel already executed proposal", async () => {
      const proposalId = await setupProposal();

      await governor.connect(member1).queueProposal(proposalId);

      const timelockDuration = await governor.timelockDurations(0);
      await ethers.provider.send("evm_increaseTime", [Number(timelockDuration) + 1]);
      await ethers.provider.send("evm_mine");

      await governor.connect(member1).executeProposal(proposalId);

      await expect(
        governor.connect(deployer).cancelProposal(proposalId)
      ).to.be.revertedWith("Governor: cannot cancel executed proposal");
    });
  });
});
