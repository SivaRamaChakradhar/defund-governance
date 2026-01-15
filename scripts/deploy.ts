import { ethers } from "hardhat";

async function main() {
  console.log("=== CryptoVentures DAO Deployment ===\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}\n`);

  // Step 1: Deploy DAORoles
  console.log("Step 1: Deploying DAORoles...");
  const DAORoles = await ethers.getContractFactory("DAORoles");
  const daoRoles = await DAORoles.deploy();
  await daoRoles.waitForDeployment();
  const rolesAddress = await daoRoles.getAddress();
  console.log(`✓ DAORoles deployed at: ${rolesAddress}\n`);

  // Step 2: Deploy GovernanceToken
  console.log("Step 2: Deploying GovernanceToken...");
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const governanceToken = await GovernanceToken.deploy();
  await governanceToken.waitForDeployment();
  const tokenAddress = await governanceToken.getAddress();
  console.log(`✓ GovernanceToken deployed at: ${tokenAddress}\n`);

  // Step 3: Deploy DAOTreasury
  console.log("Step 3: Deploying DAOTreasury...");
  const DAOTreasury = await ethers.getContractFactory("DAOTreasury");
  const treasury = await DAOTreasury.deploy(rolesAddress);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log(`✓ DAOTreasury deployed at: ${treasuryAddress}\n`);

  // Step 4: Deploy Governor
  console.log("Step 4: Deploying Governor...");
  const Governor = await ethers.getContractFactory("Governor");
  const governor = await Governor.deploy(tokenAddress, treasuryAddress, rolesAddress);
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();
  console.log(`✓ Governor deployed at: ${governorAddress}\n`);

  // Step 5: Grant roles
  console.log("Step 5: Setting up roles...");
  const PROPOSER_ROLE = await daoRoles.PROPOSER_ROLE();
  const VOTER_ROLE = await daoRoles.VOTER_ROLE();
  const EXECUTOR_ROLE = await daoRoles.EXECUTOR_ROLE();
  const GUARDIAN_ROLE = await daoRoles.GUARDIAN_ROLE();

  await daoRoles.grantRole(PROPOSER_ROLE, deployer.address);
  await daoRoles.grantRole(VOTER_ROLE, deployer.address);
  await daoRoles.grantRole(EXECUTOR_ROLE, deployer.address);
  await daoRoles.grantRole(GUARDIAN_ROLE, deployer.address);

  console.log(`✓ Roles assigned to deployer\n`);

  // Step 6: Seed initial state
  console.log("Step 6: Seeding initial test state...");

  // Deposit initial stake
  const stakeAmount = ethers.parseEther("10");
  await governanceToken.deposit({ value: stakeAmount });
  console.log(`✓ Deployer deposited ${ethers.formatEther(stakeAmount)} ETH\n`);

  // Deposit treasury funds
  const treasuryAmount = ethers.parseEther("1000");
  await deployer.sendTransaction({
    to: treasuryAddress,
    value: treasuryAmount,
  });
  console.log(`✓ Treasury received ${ethers.formatEther(treasuryAmount)} ETH\n`);

  // Create a sample proposal
  console.log("Step 7: Creating sample proposal...");
  const proposalTx = await governor.createProposal(
    deployer.address,
    ethers.parseEther("5"),
    "Sample investment proposal for testing",
    0 // HighConviction
  );
  const proposalReceipt = await proposalTx.wait();
  console.log(`✓ Sample proposal created\n`);

  console.log("=== Deployment Summary ===");
  console.log(`DAORoles:        ${rolesAddress}`);
  console.log(`GovernanceToken: ${tokenAddress}`);
  console.log(`DAOTreasury:     ${treasuryAddress}`);
  console.log(`Governor:        ${governorAddress}`);
  console.log(`\nDeployer Address: ${deployer.address}`);
  console.log(`Treasury Balance: ${ethers.formatEther(treasuryAmount)} ETH`);
  console.log(`Deployer Stake:   ${ethers.formatEther(stakeAmount)} ETH`);
  console.log("\n✓ Deployment completed successfully!");

  // Save deployment addresses
  const deploymentAddresses = {
    daoRoles: rolesAddress,
    governanceToken: tokenAddress,
    treasury: treasuryAddress,
    governor: governorAddress,
    deployer: deployer.address,
    network: (await ethers.provider.getNetwork()).name,
    timestamp: new Date().toISOString(),
  };

  console.log("\nDeployment addresses saved to deployment-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
