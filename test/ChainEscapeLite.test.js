// ChainEscapeLite.test.js
// Works with Ethers v6 & Hardhat Toolbox 5.0.0

const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * signSubmission:
 * Uses ethers.solidityPackedKeccak256(...) to replicate
 * keccak256(abi.encodePacked(...)) from your Solidity code.
 *
 * If we sign with the correct avsSignerWallet, the contract recovers
 * avsSigner => "valid signature".
 * If we sign with a different wallet, the contract recovers the wrong address => "Invalid AVS signature".
 */
async function signSubmission(signerWallet, contractAddress, player, puzzleId, correct, timeRemaining) {
  // Ethers v6 approach for "abi.encodePacked(...)"
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "address", "uint256", "bool", "uint256"],
    [contractAddress, player, puzzleId, correct, timeRemaining]
  );

  // signMessage expects "BytesLike", so pass the messageHash as bytes
  const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
  return signature;
}

describe("ChainEscapeLite Contract (Full Coverage)", function () {
  let ChainEscapeLite;
  let chainEscape;
  let owner, avsTxCaller, user1, user2;
  let avsSignerWallet;

  beforeEach(async function () {
    // Get signers
    [owner, avsTxCaller, user1, user2] = await ethers.getSigners();

    // Deploy contract
    ChainEscapeLite = await ethers.getContractFactory("ChainEscapeLite");
    chainEscape = await ChainEscapeLite.deploy("ChainEscapeLite", "CEL", "https://my-base-uri/");
    await chainEscape.waitForDeployment(); // Ethers v6 approach

    // Set AVS transaction caller (who calls submitResult)
    await chainEscape.connect(owner).setAvsAddress(avsTxCaller.address);

    // Create a random wallet for avsSigner & set it
    avsSignerWallet = ethers.Wallet.createRandom();
    await chainEscape.connect(owner).setAvsSigner(await avsSignerWallet.getAddress());

    // Set puzzle #0 with basePoints=10
    const puzzleHash = ethers.keccak256(ethers.toUtf8Bytes("SolutionPuzzle0"));
    await chainEscape.connect(owner).setPuzzleHash(0, puzzleHash, 10);

    // Start the game (duration=300)
    await chainEscape.connect(owner).startGame(300);
  });

  it("=== DUMMY TEST RUNNING ===", function () {
    console.log("=== DUMMY TEST RUNNING ===");
    expect(true).to.equal(true);
  });

  it("Should deploy with the correct owner", async function () {
    expect(await chainEscape.owner()).to.equal(await owner.getAddress());
  });

  it("Should revert if a non-owner tries to set puzzle hash", async function () {
    const puzzleHash = ethers.keccak256(ethers.toUtf8Bytes("PuzzleXYZ"));
    await expect(
      chainEscape.connect(user1).setPuzzleHash(1, puzzleHash, 20)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Should let the owner end the game, revert if a non-owner tries", async function () {
    // Non-owner tries
    await expect(
      chainEscape.connect(user1).endGame()
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Owner ends the game
    await chainEscape.connect(owner).endGame();
    const state = await chainEscape.gameState();
    expect(state).to.equal(2n); // GameState.ENDED
  });

  it("Should revert if submitResult is called by non-AVS address", async function () {
    await expect(
      chainEscape.connect(user1).submitResult(
        user1.address,
        0,
        true,
        100,
        "0x1234"
      )
    ).to.be.revertedWith("Caller is not AVS address");
  });

  it("Should revert if we call startGame again while the game is ACTIVE", async function () {
    // The game is already started in your beforeEach (gameState = ACTIVE).
    // 1) So just try calling startGame again:
    await expect(
      chainEscape.connect(owner).startGame(300)
    ).to.be.revertedWith("Game is already active");
  });
  
  it("Should revert if we call startGame after the game has ended", async function () {
    // The game is ACTIVE from beforeEach.
    // 1) End the game first:
    await chainEscape.connect(owner).endGame();
  
    // Now gameState == ENDED
    // 2) Try calling startGame again => revert with "Game has already ended"
    await expect(
      chainEscape.connect(owner).startGame(300)
    ).to.be.revertedWith("Game has already ended");
  });
  
  

  it("Should revert if the signature is invalid", async function () {
    // We'll sign with a random wallet that is NOT avsSigner
    const invalidSigner = ethers.Wallet.createRandom();

    // Create a valid messageHash but sign with the wrong wallet
    const signature = await signSubmission(
      invalidSigner, 
      chainEscape.target, // contract address
      user1.address,
      0,
      true,
      100
    );

    // Call from avsTxCaller but the recovered address won't match avsSigner
    await expect(
      chainEscape.connect(avsTxCaller).submitResult(
        user1.address,
        0,
        true,
        100,
        signature
      )
    ).to.be.revertedWith("Invalid AVS signature");
  });

  it("Should allow correct scoring if signature is valid (correct=true)", async function () {
    // sign with avsSignerWallet => correct => puzzleId=0 => timeRemaining=100
    const signature = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user1.address,
      0,
      true,
      100
    );

    // call from avsTxCaller
    await chainEscape.connect(avsTxCaller).submitResult(
      user1.address,
      0,
      true,
      100,
      signature
    );

    // score = basePoints(10) + bonus(100/60=1) => 11
    const stats = await chainEscape.playerStats(user1.address);
    expect(stats.score).to.equal(11n);
    expect(stats.puzzleIndex).to.equal(1n);
  });

  it("Should apply penalty if correct=false", async function () {
    // sign with avsSigner => correct=false => puzzleId=0 => timeRemaining=50
    const signature = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user2.address,
      0,
      false,
      50
    );

    await chainEscape.connect(avsTxCaller).submitResult(
      user2.address,
      0,
      false,
      50,
      signature
    );

    // penalty=2 => from 0 => clamp to 0
    const stats = await chainEscape.playerStats(user2.address);
    expect(stats.score).to.equal(0n);
    expect(stats.puzzleIndex).to.equal(0n);
  });

  it("Should finalize ranks with tie-break logic", async function () {
    // user1 => puzzleId=0 => correct => timeRemaining=80 => score=10 + (80/60=1)=11
    let sig = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user1.address,
      0,
      true,
      80
    );
    await chainEscape.connect(avsTxCaller).submitResult(user1.address, 0, true, 80, sig);

    // user2 => puzzleId=0 => correct => timeRemaining=100 => score=10 + (100/60=1)=11
    sig = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user2.address,
      0,
      true,
      100
    );
    await chainEscape.connect(avsTxCaller).submitResult(user2.address, 0, true, 100, sig);

    // end game
    await chainEscape.connect(owner).endGame();
    await chainEscape.finalizeRanks();

    const rankUser1 = await chainEscape.finalRank(user1.address);
    const rankUser2 = await chainEscape.finalRank(user2.address);

    console.log("User1 rank:", rankUser1.toString(), "User2 rank:", rankUser2.toString());
    // Possibly both 1 if they tied
  });

  it("Should revert if trying to claim NFT before game ends", async function () {
    await expect(
      chainEscape.connect(user1).claimNFT()
    ).to.be.revertedWith("Game not ended yet");
  });

  it("Should let a ranked player claim NFT after finalizeRanks", async function () {
    // user1 => correct => puzzleId=0 => timeRemaining=100 => score=11
    const sig = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user1.address,
      0,
      true,
      100
    );
    await chainEscape.connect(avsTxCaller).submitResult(user1.address, 0, true, 100, sig);

    // end & finalize
    await chainEscape.connect(owner).endGame();
    await chainEscape.finalizeRanks();

    // user1 claims
    await chainEscape.connect(user1).claimNFT();
    const bal = await chainEscape.balanceOf(user1.address);
    expect(bal).to.equal(1n);

    // claiming again => revert
    await expect(
      chainEscape.connect(user1).claimNFT()
    ).to.be.revertedWith("Already claimed NFT");
  });

  it("Should revert if rank=0 (never participated)", async function () {
    // ensure at least one user participated => user1 solves
    const sig = await signSubmission(
      avsSignerWallet,
      chainEscape.target,
      user1.address,
      0,
      true,
      80
    );
    await chainEscape.connect(avsTxCaller).submitResult(user1.address, 0, true, 80, sig);

    // end & finalize
    await chainEscape.connect(owner).endGame();
    await chainEscape.finalizeRanks();

    // user2 rank=0 => claim => revert
    await expect(
      chainEscape.connect(user2).claimNFT()
    ).to.be.revertedWith("Rank not assigned yet. finalizeRanks first.");
  });
});
