// scripts/deploy.js

const hre = require("hardhat");

async function main() {
  // 1) Get the ContractFactory
  const ChainEscapeLite = await hre.ethers.getContractFactory("ChainEscapeLite");

  // 2) Deploy the contract
  const chainEscape = await ChainEscapeLite.deploy(
    "ChainEscapeLite",   // _name
    "CEL",               // _symbol
    "https://my-base-uri/"  // _baseTokenURI
  );

  // 3) Wait for deployment (Ethers v6 style)
  await chainEscape.waitForDeployment();

  // 4) Log the address
  console.log("ChainEscapeLite deployed to:", chainEscape.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
