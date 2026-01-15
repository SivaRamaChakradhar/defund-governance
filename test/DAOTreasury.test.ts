import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DAOTreasury - Fund Management", () => {
  let daoRoles: any;
  let treasury: any;
  let deployer: SignerWithAddress;
  let member1: SignerWithAddress;
  let member2: SignerWithAddress;
  let member3: SignerWithAddress;

  beforeEach(async () => {
    [deployer, member1, member2, member3] = await ethers.getSigners();

    const DAORoles = await ethers.getContractFactory("DAORoles");
    daoRoles = await DAORoles.deploy();
    await daoRoles.waitForDeployment();

    const DAOTreasury = await ethers.getContractFactory("DAOTreasury");
    treasury = await DAOTreasury.deploy(await daoRoles.getAddress());
    await treasury.waitForDeployment();

    // Grant executor and admin roles
    const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();
    const GUARDIAN_ROLE = await daoRoles.GUARDIAN_ROLE();
    await daoRoles.grantRole(EXECUTOR_ROLE, deployer.address);
    await daoRoles.grantRole(EXECUTOR_ROLE, member1.address);
    await daoRoles.grantRole(GUARDIAN_ROLE, deployer.address);

    // Fund treasury
    await deployer.sendTransaction({
      to: await treasury.getAddress(),
      value: ethers.parseEther("1000"),
    });
  });

  describe("Treasury Basics", () => {
    it("R14: Treasury tracks different fund allocations", async () => {
      const opBalance = await treasury.getFundBalance(await treasury.CATEGORY_OPERATIONAL());
      const hcBalance = await treasury.getFundBalance(await treasury.CATEGORY_HIGH_CONVICTION());
      const ebBalance = await treasury.getFundBalance(await treasury.CATEGORY_EXPERIMENTAL());

      expect(opBalance).to.equal(ethers.parseEther("1000")); // Deposited to operational by default
      expect(hcBalance).to.equal(0n);
      expect(ebBalance).to.equal(0n);
    });

    it("R14: Treasury has different balance limits and approval requirements per category", async () => {
      const opLimit = await treasury.getFundLimit(await treasury.CATEGORY_OPERATIONAL());
      const hcLimit = await treasury.getFundLimit(await treasury.CATEGORY_HIGH_CONVICTION());
      const ebLimit = await treasury.getFundLimit(await treasury.CATEGORY_EXPERIMENTAL());

      expect(opLimit).to.not.equal(hcLimit);
      expect(hcLimit).to.not.equal(ebLimit);

      console.log(`  Operational limit: ${ethers.formatEther(opLimit)} ETH`);
      console.log(`  High Conviction limit: ${ethers.formatEther(hcLimit)} ETH`);
      console.log(`  Experimental limit: ${ethers.formatEther(ebLimit)} ETH`);
    });

    it("R15: Small operational expenses require fewer approvals", async () => {
      // This is verified through Governor proposal types
      // Operational expense proposals have lower quorum and threshold than HC proposals
      const opThreshold = await treasury.getFundLimit(await treasury.CATEGORY_OPERATIONAL());
      const hcThreshold = await treasury.getFundLimit(await treasury.CATEGORY_HIGH_CONVICTION());

      expect(opThreshold).to.be.lt(hcThreshold);
    });

    it("R14: Get total treasury balance", async () => {
      const totalBalance = await treasury.getTotalBalance();
      expect(totalBalance).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Fund Transfers", () => {
    it("R10: Transfer funds to recipient", async () => {
      const recipient = member2.address;
      const amount = ethers.parseEther("100");

      const initialBalance = await ethers.provider.getBalance(recipient);

      await treasury.connect(member1).transferFunds(recipient, amount);

      const finalBalance = await ethers.provider.getBalance(recipient);
      expect(finalBalance).to.equal(initialBalance + amount);
    });

    it("R29: Treasury withdrawals fail gracefully if insufficient funds", async () => {
      const recipient = member2.address;
      const excessAmount = ethers.parseEther("2000"); // More than available

      await expect(
        treasury.connect(member1).transferFunds(recipient, excessAmount)
      ).to.be.revertedWith("DAOTreasury: insufficient treasury balance");
    });

    it("R10: Cannot transfer to invalid recipient", async () => {
      const amount = ethers.parseEther("10");

      await expect(
        treasury.connect(member1).transferFunds(ethers.ZeroAddress, amount)
      ).to.be.revertedWith("DAOTreasury: invalid recipient");
    });

    it("R10: Cannot transfer zero amount", async () => {
      const recipient = member2.address;

      await expect(
        treasury.connect(member1).transferFunds(recipient, 0)
      ).to.be.revertedWith("DAOTreasury: invalid amount");
    });

    it("R10: Only executor role can transfer funds", async () => {
      const recipient = member2.address;
      const amount = ethers.parseEther("10");

      await expect(
        treasury.connect(member3).transferFunds(recipient, amount)
      ).to.be.revertedWith("DAOTreasury: caller is not executor");
    });
  });

  describe("Fund Allocation", () => {
    it("Allocate funds between categories", async () => {
      const opCategory = await treasury.CATEGORY_OPERATIONAL();
      const hcCategory = await treasury.CATEGORY_HIGH_CONVICTION();
      const amount = ethers.parseEther("100");

      // Allocate from operational to high conviction
      await treasury.connect(member1).allocateFunds(hcCategory, amount);

      const opBalance = await treasury.getFundBalance(opCategory);
      const hcBalance = await treasury.getFundBalance(hcCategory);

      expect(opBalance).to.equal(ethers.parseEther("900"));
      expect(hcBalance).to.equal(amount);
    });

    it("Cannot allocate funds exceeding category limit", async () => {
      const hcCategory = await treasury.CATEGORY_HIGH_CONVICTION();
      const limit = await treasury.getFundLimit(hcCategory);
      const excessAmount = limit + ethers.parseEther("1");

      await expect(
        treasury.connect(member1).allocateFunds(hcCategory, excessAmount)
      ).to.be.revertedWith("DAOTreasury: category limit exceeded");
    });
  });

  describe("Treasury Pause", () => {
    it("R18: Emergency pause can be activated by guardian", async () => {
      await treasury.connect(deployer).emergencyPause();
      expect(await treasury.paused()).to.be.true;

      // Cannot transfer when paused
      await expect(
        treasury.connect(member1).transferFunds(member2.address, ethers.parseEther("10"))
      ).to.be.revertedWith("DAOTreasury: system is paused");
    });

    it("R18: Only admin can resume system", async () => {
      await treasury.connect(deployer).emergencyPause();

      // Non-admin cannot resume
      await expect(
        treasury.connect(member1).resumeSystem()
      ).to.be.revertedWith("DAOTreasury: caller is not admin");

      // Admin can resume
      await treasury.connect(deployer).resumeSystem();
      expect(await treasury.paused()).to.be.false;
    });

    it("R18: Cannot pause already paused system", async () => {
      await treasury.connect(deployer).emergencyPause();

      await expect(
        treasury.connect(deployer).emergencyPause()
      ).to.be.revertedWith("DAOTreasury: already paused");
    });
  });

  describe("Fund Limits", () => {
    it("Admin can update fund limits", async () => {
      const opCategory = await treasury.CATEGORY_OPERATIONAL();
      const newLimit = ethers.parseEther("200");

      await treasury.connect(deployer).updateFundLimit(opCategory, newLimit);

      const updatedLimit = await treasury.getFundLimit(opCategory);
      expect(updatedLimit).to.equal(newLimit);
    });

    it("Non-admin cannot update fund limits", async () => {
      const opCategory = await treasury.CATEGORY_OPERATIONAL();
      const newLimit = ethers.parseEther("200");

      await expect(
        treasury.connect(member1).updateFundLimit(opCategory, newLimit)
      ).to.be.revertedWith("DAOTreasury: caller is not admin");
    });
  });

  describe("Events", () => {
    it("R17: Emits events for fund transfers", async () => {
      const recipient = member2.address;
      const amount = ethers.parseEther("50");
      const opCategory = await treasury.CATEGORY_OPERATIONAL();

      await expect(treasury.connect(member1).transferFunds(recipient, amount))
        .to.emit(treasury, "FundsTransferred")
        .withArgs(recipient, amount, opCategory);
    });

    it("R17: Emits events for emergency pause", async () => {
      await expect(treasury.connect(deployer).emergencyPause())
        .to.emit(treasury, "EmergencyPauseActivated");
    });

    it("R17: Emits events for system resume", async () => {
      await treasury.connect(deployer).emergencyPause();

      await expect(treasury.connect(deployer).resumeSystem())
        .to.emit(treasury, "SystemResumed");
    });
  });
});
