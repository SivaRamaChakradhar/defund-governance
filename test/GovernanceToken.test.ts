import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GovernanceToken - Staking and Voting Power", () => {
  let governanceToken: any;
  let deployer: SignerWithAddress;
  let member1: SignerWithAddress;
  let member2: SignerWithAddress;
  let member3: SignerWithAddress;

  beforeEach(async () => {
    [deployer, member1, member2, member3] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceToken.deploy();
    await governanceToken.waitForDeployment();
  });

  describe("Staking", () => {
    it("R1: Members can deposit ETH to gain governance influence", async () => {
      const depositAmount = ethers.parseEther("10");

      await expect(
        governanceToken.connect(member1).deposit({ value: 0 })
      ).to.be.revertedWith("GovernanceToken: deposit amount must be greater than 0");

      await governanceToken.connect(member1).deposit({ value: depositAmount });

      const stake = await governanceToken.getStake(member1.address);
      expect(stake).to.equal(depositAmount);
    });

    it("R1: Stake prevents whale dominance with anti-whale mechanism", async () => {
      // Small stakeholder
      const smallStake = ethers.parseEther("1");
      await governanceToken.connect(member1).deposit({ value: smallStake });

      // Large stakeholder (whale)
      const largeStake = ethers.parseEther("100");
      await governanceToken.connect(member2).deposit({ value: largeStake });

      const smallVotingPower = await governanceToken.getVotingPower(member1.address);
      const largeVotingPower = await governanceToken.getVotingPower(member2.address);

      // Voting power should not be proportional (anti-whale)
      // With sqrt, 100x stake should not give 100x voting power
      const ratio = (largeVotingPower * 100n) / smallVotingPower;
      expect(ratio).to.be.lt(10000n); // Less than 100x

      console.log(`  Small voting power: ${smallVotingPower}`);
      console.log(`  Large voting power: ${largeVotingPower}`);
      console.log(`  Ratio: ${ratio / 100n}x (anti-whale effective)`);
    });

    it("R2: Members can withdraw their stake", async () => {
      const depositAmount = ethers.parseEther("10");
      await governanceToken.connect(member1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("5");
      const initialBalance = await ethers.provider.getBalance(member1.address);

      const tx = await governanceToken.connect(member1).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const finalBalance = await ethers.provider.getBalance(member1.address);
      const remainingStake = await governanceToken.getStake(member1.address);

      expect(remainingStake).to.equal(depositAmount - withdrawAmount);
      expect(finalBalance).to.equal(initialBalance + withdrawAmount - gasUsed);
    });

    it("R2: Cannot withdraw more than staked amount", async () => {
      const depositAmount = ethers.parseEther("10");
      await governanceToken.connect(member1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("20");
      await expect(
        governanceToken.connect(member1).withdraw(withdrawAmount)
      ).to.be.revertedWith("GovernanceToken: insufficient stake");
    });

    it("R2: Cannot deposit zero amount", async () => {
      await expect(
        governanceToken.connect(member1).deposit({ value: 0 })
      ).to.be.revertedWith("GovernanceToken: deposit amount must be greater than 0");
    });

    it("R20: Minimum stake requirement for proposals", async () => {
      const minStake = await governanceToken.MIN_STAKE_TO_PROPOSE();

      // Below minimum
      const smallStake = minStake - 1n;
      await governanceToken.connect(member1).deposit({ value: smallStake });
      let canPropose = await governanceToken.canPropose(member1.address);
      expect(canPropose).to.be.false;

      // At minimum
      await governanceToken.connect(member1).deposit({ value: 1n });
      canPropose = await governanceToken.canPropose(member1.address);
      expect(canPropose).to.be.true;
    });
  });

  describe("Voting Power Calculation", () => {
    it("R24: Voting power is calculated consistently using anti-whale mechanism", async () => {
      await governanceToken.connect(member1).deposit({ value: ethers.parseEther("4") });
      await governanceToken.connect(member2).deposit({ value: ethers.parseEther("9") });

      const power1 = await governanceToken.getVotingPower(member1.address);
      const power2 = await governanceToken.getVotingPower(member2.address);

      const expected1 = sqrtBigInt(ethers.parseEther("4"));
      const expected2 = sqrtBigInt(ethers.parseEther("9"));
      expect(power1).to.equal(expected1);
      expect(power2).to.equal(expected2);
    });

    it("R21: Can read voting power without voting", async () => {
      const stakeAmount = ethers.parseEther("16");
      await governanceToken.connect(member1).deposit({ value: stakeAmount });

      const votingPower = await governanceToken.getVotingPower(member1.address);
      const expected = sqrtBigInt(stakeAmount);
      expect(votingPower).to.equal(expected);
    });
  });

  describe("Delegation", () => {
    it("R5: Members can delegate voting power to another member", async () => {
      const stakeAmount = ethers.parseEther("16");
      await governanceToken.connect(member1).deposit({ value: stakeAmount });

      // Before delegation, member1 has voting power
      let power = await governanceToken.getVotingPower(member1.address);
      expect(power).to.equal(sqrtBigInt(stakeAmount));

      // After delegation, member1 should have 0 (delegated)
      await governanceToken.connect(member1).delegateVotingPower(member2.address);
      power = await governanceToken.getVotingPower(member1.address);
      expect(power).to.equal(0n);

      const delegation = await governanceToken.getDelegation(member1.address);
      expect(delegation).to.equal(member2.address);
    });

    it("R5: Delegation should be revocable", async () => {
      const stakeAmount = ethers.parseEther("16");
      await governanceToken.connect(member1).deposit({ value: stakeAmount });

      await governanceToken.connect(member1).delegateVotingPower(member2.address);
      let delegation = await governanceToken.getDelegation(member1.address);
      expect(delegation).to.equal(member2.address);

      await governanceToken.connect(member1).revokeDelegation();
      delegation = await governanceToken.getDelegation(member1.address);
      expect(delegation).to.equal(ethers.ZeroAddress);

      const power = await governanceToken.getVotingPower(member1.address);
      expect(power).to.equal(sqrtBigInt(stakeAmount));
    });

    it("R5: Cannot delegate to self", async () => {
      const stakeAmount = ethers.parseEther("16");
      await governanceToken.connect(member1).deposit({ value: stakeAmount });

      await expect(
        governanceToken.connect(member1).delegateVotingPower(member1.address)
      ).to.be.revertedWith("GovernanceToken: cannot delegate to self");
    });

    it("R5: Cannot delegate without stake", async () => {
      await expect(
        governanceToken.connect(member1).delegateVotingPower(member2.address)
      ).to.be.revertedWith("GovernanceToken: no stake to delegate");
    });

    it("R5: Cannot revoke non-existent delegation", async () => {
      await expect(
        governanceToken.connect(member1).revokeDelegation()
      ).to.be.revertedWith("GovernanceToken: no delegation to revoke");
    });
  });
});

// Integer sqrt helper that mirrors contract logic
function sqrtBigInt(value: bigint): bigint {
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}
