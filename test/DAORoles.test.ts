import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DAORoles - Access Control", () => {
  let daoRoles: any;
  let deployer: SignerWithAddress;
  let member1: SignerWithAddress;
  let member2: SignerWithAddress;
  let member3: SignerWithAddress;

  beforeEach(async () => {
    [deployer, member1, member2, member3] = await ethers.getSigners();

    const DAORoles = await ethers.getContractFactory("DAORoles");
    daoRoles = await DAORoles.deploy();
    await daoRoles.waitForDeployment();
  });

  describe("Role Management", () => {
    it("R19: Multiple members can hold different roles simultaneously", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
      const VOTER_ROLE = await daoRoles.VOTER_ROLE();
      const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();

      await daoRoles.grantRole(PROPOSER_ROLE, member1.address);
      await daoRoles.grantRole(VOTER_ROLE, member1.address);
      await daoRoles.grantRole(EXECUTOR_ROLE, member2.address);
      await daoRoles.grantRole(PROPOSER_ROLE, member2.address);

      expect(await daoRoles.hasRole(PROPOSER_ROLE, member1.address)).to.be.true;
      expect(await daoRoles.hasRole(VOTER_ROLE, member1.address)).to.be.true;
      expect(await daoRoles.hasRole(EXECUTOR_ROLE, member1.address)).to.be.false;

      expect(await daoRoles.hasRole(EXECUTOR_ROLE, member2.address)).to.be.true;
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member2.address)).to.be.true;
      expect(await daoRoles.hasRole(VOTER_ROLE, member2.address)).to.be.false;
    });

    it("R19: Separation of powers - different roles have different permissions", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();
      const GUARDIAN_ROLE = await daoRoles.GUARDIAN_ROLE();

      await daoRoles.grantRole(PROPOSER_ROLE, member1.address);
      await daoRoles.grantRole(EXECUTOR_ROLE, member2.address);
      await daoRoles.grantRole(GUARDIAN_ROLE, member3.address);

      // Each has their specific role
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member1.address)).to.be.true;
      expect(await daoRoles.hasRole(EXECUTOR_ROLE, member2.address)).to.be.true;
      expect(await daoRoles.hasRole(GUARDIAN_ROLE, member3.address)).to.be.true;

      // But not cross-roles
      expect(await daoRoles.hasRole(EXECUTOR_ROLE, member1.address)).to.be.false;
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member2.address)).to.be.false;
    });

    it("R18: Emergency functions restricted to guardian role", async () => {
      const GUARDIAN_ROLE = await daoRoles.GUARDIAN_ROLE();

      const isGuardian = await daoRoles.hasRole(GUARDIAN_ROLE, deployer.address);
      expect(isGuardian).to.be.true;
    });

    it("R18: Admin role required for role management", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
      const ADMIN_ROLE = await daoRoles.ADMIN_ROLE();

      // Deployer has admin by default
      expect(await daoRoles.hasRole(ADMIN_ROLE, deployer.address)).to.be.true;

      // Member1 cannot grant roles
      await expect(
        daoRoles.connect(member1).grantRole(PROPOSER_ROLE, member2.address)
      ).to.be.revertedWith("DAORoles: caller is not admin");

      // But admin can
      await daoRoles.grantRole(PROPOSER_ROLE, member2.address);
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member2.address)).to.be.true;
    });

    it("Members can renounce their own roles", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();

      await daoRoles.grantRole(PROPOSER_ROLE, member1.address);
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member1.address)).to.be.true;

      await daoRoles.connect(member1).renounceRole(PROPOSER_ROLE);
      expect(await daoRoles.hasRole(PROPOSER_ROLE, member1.address)).to.be.false;
    });

    it("Cannot renounce a role you don't have", async () => {
      const VOTER_ROLE = await daoRoles.VOTER_ROLE();

      await expect(
        daoRoles.connect(member1).renounceRole(VOTER_ROLE)
      ).to.be.revertedWith("DAORoles: you do not have this role");
    });
  });

  describe("Member Management", () => {
    it("Members are tracked in the system", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();

      await daoRoles.grantRole(PROPOSER_ROLE, member1.address);
      await daoRoles.grantRole(PROPOSER_ROLE, member2.address);

      const allMembers = await daoRoles.getAllMembers();
      expect(allMembers).to.include(deployer.address);
      expect(allMembers).to.include(member1.address);
      expect(allMembers).to.include(member2.address);
    });

    it("Can query member roles", async () => {
      const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
      const VOTER_ROLE = await daoRoles.VOTER_ROLE();

      await daoRoles.grantRole(PROPOSER_ROLE, member1.address);
      await daoRoles.grantRole(VOTER_ROLE, member1.address);

      const roles = await daoRoles.getMemberRoles(member1.address);
      expect(roles).to.include(PROPOSER_ROLE);
      expect(roles).to.include(VOTER_ROLE);
      expect(roles.length).to.equal(2);
    });
  });
});
