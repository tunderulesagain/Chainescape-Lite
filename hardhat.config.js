require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.28",
  networks: {
    sepolia: {
      url: "https://sepolia.infura.io/v3/7b5112e1afab4e22978ac18bab03379e",
      accounts: [
        "0x" + process.env.PRIVATE_KEY
      ]
    }
  },
  etherscan: {
    apiKey: {
      // Etherscan API Key for Sepolia
      sepolia: process.env.ETHERSCAN_API_KEY
    }
  },
  sourcify: {
    enabled: true
  }
};
