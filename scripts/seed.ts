import { ethers } from "hardhat";

/**
 * Script to seed the DAO with test data
 * Creates multiple members with different stake levels, proposals, and votes
 */
async function main() {
  console.log("=== DAO Test Data Seeding ===\n");

  const [deployer, member1, member2, member3, member4, member5] =
    await ethers.getSigners();

  // Get deployed contracts
  const daoRoles = await ethers.getContractAt("DAORoles", process.env.DAO_ROLES_ADDRESS || "");
  const governanceToken = await ethers.getContractAt(
    "GovernanceToken",
    process.env.GOVERNANCE_TOKEN_ADDRESS || ""
  );
  const governor = await ethers.getContractAt(
    "Governor",
    process.env.GOVERNOR_ADDRESS || ""
  );
  const treasury = await ethers.getContractAt(
    "DAOTreasury",
    process.env.TREASURY_ADDRESS || ""
  );

  // Setup roles for all members
  const VOTER_ROLE = await daoRoles.VOTER_ROLE();
  const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();

  console.log("Step 1: Granting roles to test members...");
  for (const member of [member1, member2, member3, member4, member5]) {
    await daoRoles.grantRole(VOTER_ROLE, member.address);
    await daoRoles.grantRole(PROPOSER_ROLE, member.address);
  }
  console.log("✓ Roles granted\n");

  // Have members deposit stakes
  console.log("Step 2: Seeding member stakes...");
  const stakes = [
    { member: member1, amount: ethers.parseEther("100") },
    { member: member2, amount: ethers.parseEther("50") },
    { member: member3, amount: ethers.parseEther("25") },
    { member: member4, amount: ethers.parseEther("10") },
    { member: member5, amount: ethers.parseEther("5") },
  ];

  for (const { member, amount } of stakes) {
    await governanceToken.connect(member).deposit({ value: amount });
    console.log(
      `✓ ${member.address.slice(0, 6)}... deposited ${ethers.formatEther(amount)} ETH`
    );
  }
  console.log();

  // Fund treasury if not already funded
  const treasuryBalance = await ethers.provider.getBalance(
    await treasury.getAddress()
  );
  if (treasuryBalance < ethers.parseEther("100")) {
    console.log("Step 3: Funding treasury...");
    await deployer.sendTransaction({
      to: await treasury.getAddress(),
      value: ethers.parseEther("500"),
    });
    console.log("✓ Treasury funded with 500 ETH\n");
  } else {
    console.log("Step 3: Treasury already funded\n");
  }

  // Create sample proposals
  console.log("Step 4: Creating sample proposals...");

  const proposals = [
    {
      member: member1,
      recipient: member2.address,
      amount: ethers.parseEther("10"),
      description: "Fund marketing campaign",
      type: 0, // HighConviction
    },
    {
      member: member2,
      recipient: member3.address,
      amount: ethers.parseEther("5"),
      description: "Experimental blockchain research",
      type: 1, // ExperimentalBet
    },
    {
      member: member3,
      recipient: member4.address,
      amount: ethers.parseEther("2"),
      description: "Operational expenses for Q1",
      type: 2, // OperationalExpense
    },
  ];

  let proposalIds: number[] = [];

  for (const proposal of proposals) {
    const tx = await governor.connect(proposal.member).createProposal(
      proposal.recipient,
      proposal.amount,
      proposal.description,
      proposal.type
    );
    const receipt = await tx.wait();

    const proposalCount = await governor.proposalCount();
    const newProposalId = Number(proposalCount) - 1;
    proposalIds.push(newProposalId);

    console.log(
      `✓ Proposal ${newProposalId}: ${proposal.description} (${ethers.formatEther(proposal.amount)} ETH)`
    );
  }
  console.log();

  // Cast votes on proposals
  console.log("Step 5: Casting votes on proposals...");

  // Vote on first proposal
  if (proposalIds.length > 0) {
    const proposal0 = proposalIds[0];
    await governor.connect(member1).castVote(proposal0, 0); // For
    await governor.connect(member2).castVote(proposal0, 0); // For
    await governor.connect(member3).castVote(proposal0, 1); // Against
    console.log(
      `✓ Votes cast on proposal ${proposal0}: 2 For, 1 Against, 0 Abstain`
    );
  }

  // Vote on second proposal
  if (proposalIds.length > 1) {
    const proposal1 = proposalIds[1];
    await governor.connect(member2).castVote(proposal1, 0); // For
    await governor.connect(member3).castVote(proposal1, 0); // For
    await governor.connect(member4).castVote(proposal1, 2); // Abstain
    console.log(
      `✓ Votes cast on proposal ${proposal1}: 2 For, 0 Against, 1 Abstain`
    );
  }

  console.log("\n=== Seeding Complete ===");
  console.log(`Members created: ${stakes.length}`);
  console.log(`Proposals created: ${proposalIds.length}`);
  console.log(`Treasury balance: ${ethers.formatEther(treasuryBalance)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
