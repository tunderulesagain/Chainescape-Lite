// scripts/addPuzzleCreator.js
const hre = require("hardhat");

async function main() {
  // Print which signer is used
  const [signer] = await hre.ethers.getSigners();
  console.log("Script is signing with:", await signer.getAddress());

  // 1) Your deployed contract address
  const chainEscapeAddress = "0xA2c9aB697023A3E456830B5A70EAaFeb77cDE8D6";

  // 2) The Formation address you want to grant puzzle creation
  const formationAddress = "0xD19117cc7bFe58bB42081cAa0d3fd29a546aF7dd";

  // 3) Get a contract instance
  const chainEscape = await hre.ethers.getContractAt("ChainEscapeLite", chainEscapeAddress);

  // 4) As the owner, call setPuzzleCreator(formationAddress, true)
  const tx = await chainEscape.setPuzzleCreator(formationAddress, true);
  await tx.wait();

  console.log(`Formation address ${formationAddress} is now a puzzle creator on ${chainEscapeAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
