// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ChainEscapeLite
 * @dev A single-contract solution for an on-chain escape room with:
 *  - Puzzle storage & hashing
 *  - AVS-verified scoring (including synonyms/fuzzy logic off-chain)
 *  - Advanced tie-break logic (score > puzzleIndex > earliest solve)
 *  - NFT rewards that reflect final rank and score
 * 
 *  The off-chain AI/AVS performs flexible answer checks (e.g., synonyms),
 *  then signs a message attesting correctness. The contract verifies 
 *  that signature to ensure trustless scoring.
 */
contract ChainEscapeLite is ERC721, Ownable {
    using ECDSA for bytes32;

    // -------------------------
    // Enums & Structs
    // -------------------------

    enum GameState { NOT_STARTED, ACTIVE, ENDED }

    struct Puzzle {
        bytes32 puzzleHash;    // Hash of the correct solution (or canonical form)
        uint256 basePoints;    // Points for correct solution
        bool active;
    }

    struct PlayerStats {
        uint256 score;         // Accumulated score
        uint256 puzzleIndex;   // Next puzzle the player must solve
        bool claimedNFT;       // Has the player claimed their NFT?
        bool isActivePlayer;   // True once they solve or attempt a puzzle
        uint256 lastSolveTime; // Block timestamp of their last correct solve
    }

    // -------------------------
    // State Variables
    // -------------------------

    // Roles
    address public avsAddress;   // The AVS's address for transaction calls
    address public avsSigner;    // Public key used to verify AVS signatures

    // Puzzle Creator Role
    mapping(address => bool) public puzzleCreators;

    // Game Lifecycle
    GameState public gameState;
    uint256 public gameStartTimestamp;
    uint256 public gameDuration; // in seconds

    // Puzzle Storage
    uint256 public puzzleCount;
    mapping(uint256 => Puzzle) public puzzles;

    // Player Data
    address[] public allPlayers;
    mapping(address => PlayerStats) public playerStats;

    // NFT
    uint256 private _tokenIds;
    string public baseTokenURI;

    // Final Ranks
    mapping(address => uint256) public finalRank;

    // -------------------------
    // Events
    // -------------------------

    event GameStarted(uint256 startTime, uint256 duration);
    event GameEnded(uint256 endTime);
    event PuzzleHashSet(uint256 puzzleId, bytes32 puzzleHash, uint256 basePoints);
    event ResultSubmitted(address indexed player, bool correct, uint256 newScore);
    event NFTClaimed(address indexed player, uint256 tokenId, uint256 rank);
    event RanksFinalized();

    // -------------------------
    // Constructor
    // -------------------------

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseTokenURI
    ) ERC721(_name, _symbol) 
      Ownable() 
    {
        // Manually set the owner
        _transferOwnership(msg.sender);
        
        baseTokenURI = _baseTokenURI;
        gameState = GameState.NOT_STARTED;
    }

    // -------------------------
    // Modifiers
    // -------------------------

    modifier onlyWhenActive() {
        require(gameState == GameState.ACTIVE, "Game is not active");
        require(block.timestamp <= (gameStartTimestamp + gameDuration), "Time is up");
        _;
    }

    /**
     * @dev Restricts function access to puzzle creators or the contract owner.
     */
    modifier onlyPuzzleCreator() {
        require(
            puzzleCreators[msg.sender] || msg.sender == owner(),
            "Not a puzzle creator nor owner"
        );
        _;
    }

    // -------------------------
    // Admin Functions
    // -------------------------

    /**
     * @dev Assign or remove puzzle-creation privileges to an address.
     *      Only the owner can call this.
     */
    function setPuzzleCreator(address _creator, bool _isCreator) external onlyOwner {
        puzzleCreators[_creator] = _isCreator;
    }

    /**
     * @dev Set the AVS transaction caller address (who calls submitResult).
     */
    function setAvsAddress(address _avsAddress) external onlyOwner {
        avsAddress = _avsAddress;
    }

    /**
     * @dev Set the public key used to verify AVS signatures.
     *      This can be the same as avsAddress if your AVS signs with that key,
     *      or a separate key if you prefer better security.
     */
    function setAvsSigner(address _avsSigner) external onlyOwner {
        avsSigner = _avsSigner;
    }

    /**
     * @dev Start the game with a countdown.
     */
    function startGame(uint256 _durationInSeconds) external onlyOwner {
        if (gameState == GameState.ACTIVE) {
            revert("Game is already active");
        }
        if (gameState == GameState.ENDED) {
            revert("Game has already ended");
        }

        gameDuration = _durationInSeconds;
        gameStartTimestamp = block.timestamp;
        gameState = GameState.ACTIVE;

        emit GameStarted(block.timestamp, _durationInSeconds);
    }

    /**
     * @dev End the game manually or let time run out.
     */
    function endGame() external onlyOwner {
        require(gameState == GameState.ACTIVE, "Game not active");
        gameState = GameState.ENDED;
        emit GameEnded(block.timestamp);
    }

    // -------------------------
    // Puzzle Setup
    // -------------------------

    /**
     * @dev The off-chain AI or puzzle creator sets puzzle data on-chain. 
     *      This might store a canonical "official" solution hash, 
     *      even though the AVS does fuzzy checks off-chain.
     *      Only puzzle creators or the owner can call this.
     */
    function setPuzzleHash(
        uint256 puzzleId,
        bytes32 _puzzleHash,
        uint256 _basePoints
    )
        external
        onlyPuzzleCreator
    {
        puzzles[puzzleId] = Puzzle({
            puzzleHash: _puzzleHash,
            basePoints: _basePoints,
            active: true
        });
        if (puzzleId >= puzzleCount) {
            puzzleCount = puzzleId + 1;
        }
        emit PuzzleHashSet(puzzleId, _puzzleHash, _basePoints);
    }

    // -------------------------
    // Off-Chain Verification & Submit
    // -------------------------

    /**
     * @dev The AVS calls this after doing fuzzy logic off-chain. 
     *      'signature' is the AVS's cryptographic proof that it 
     *      decided 'correct' = true/false for (player, puzzleId).
     *
     * @param player The user who answered
     * @param puzzleId The puzzle ID
     * @param correct True if the AVS decided the user was "close enough"
     * @param timeRemaining Time left in the game (for bonus)
     * @param signature ECDSA signature from avsSigner verifying this result
     */
    function submitResult(
        address player,
        uint256 puzzleId,
        bool correct,
        uint256 timeRemaining,
        bytes calldata signature
    )
        external
        onlyWhenActive
    {
        // 1) Ensure the caller is the AVS transaction address
        require(msg.sender == avsAddress, "Caller is not AVS address");

        // 2) Verify the signature from avsSigner
        bytes32 messageHash = keccak256(abi.encodePacked(
            address(this),  // Include contract address to avoid replay
            player,
            puzzleId,
            correct,
            timeRemaining
        ));

        // ECDSA: We expect avsSigner to have signed the messageHash
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        require(recovered == avsSigner, "Invalid AVS signature");

        // 3) Check puzzle logic
        PlayerStats storage stats = playerStats[player];

        // Mark them active if first time
        if (!stats.isActivePlayer) {
            stats.isActivePlayer = true;
            allPlayers.push(player);
        }

        require(puzzleId == stats.puzzleIndex, "Wrong puzzle index");
        Puzzle storage puzzle = puzzles[puzzleId];
        require(puzzle.active, "Puzzle not active");

        if (correct) {
            // Award base points
            uint256 pointsAwarded = puzzle.basePoints;

            // Optional time-based bonus
            uint256 bonus = timeRemaining / 60; 
            pointsAwarded += bonus;

            stats.score += pointsAwarded;
            stats.puzzleIndex += 1;
            stats.lastSolveTime = block.timestamp;
        } else {
            // Deduct penalty
            uint256 penalty = 2;
            if (stats.score >= penalty) {
                stats.score -= penalty;
            } else {
                stats.score = 0;
            }
        }

        emit ResultSubmitted(player, correct, stats.score);
    }

    // -------------------------
    // Tie-Breaking & Final Ranks
    // -------------------------

    /**
     * @dev Sorts all players on-chain using tie-break logic:
     *      1) Score (desc)
     *      2) Puzzle Index (desc)
     *      3) Last Solve Time (asc)
     *      If still identical, they share the same rank.
     *
     * NOTE: O(n^2) bubble sort for small games. 
     */
    function finalizeRanks() external {
        require(
            gameState == GameState.ENDED ||
            block.timestamp > (gameStartTimestamp + gameDuration),
            "Game not ended yet"
        );

        address[] memory sortedPlayers = new address[](allPlayers.length);
        for (uint256 i = 0; i < allPlayers.length; i++) {
            sortedPlayers[i] = allPlayers[i];
        }

        // Bubble sort with tie-break
        for (uint256 i = 0; i < sortedPlayers.length; i++) {
            for (uint256 j = i + 1; j < sortedPlayers.length; j++) {
                if (isBetter(sortedPlayers[j], sortedPlayers[i])) {
                    address temp = sortedPlayers[i];
                    sortedPlayers[i] = sortedPlayers[j];
                    sortedPlayers[j] = temp;
                }
            }
        }

        // Assign ranks (competition style)
        finalRank[sortedPlayers[0]] = 1;

        for (uint256 k = 1; k < sortedPlayers.length; k++) {
            if (areTied(sortedPlayers[k], sortedPlayers[k-1])) {
                finalRank[sortedPlayers[k]] = finalRank[sortedPlayers[k-1]];
            } else {
                finalRank[sortedPlayers[k]] = k + 1;
            }
        }

        emit RanksFinalized();
    }

    function isBetter(address a, address b) internal view returns (bool) {
        // 1) Score desc
        if (playerStats[a].score > playerStats[b].score) return true;
        if (playerStats[a].score < playerStats[b].score) return false;

        // 2) PuzzleIndex desc
        if (playerStats[a].puzzleIndex > playerStats[b].puzzleIndex) return true;
        if (playerStats[a].puzzleIndex < playerStats[b].puzzleIndex) return false;

        // 3) LastSolveTime asc
        if (playerStats[a].lastSolveTime < playerStats[b].lastSolveTime) return true;
        if (playerStats[a].lastSolveTime > playerStats[b].lastSolveTime) return false;

        // Tied
        return false;
    }

    function areTied(address a, address b) internal view returns (bool) {
        return (
            playerStats[a].score == playerStats[b].score &&
            playerStats[a].puzzleIndex == playerStats[b].puzzleIndex &&
            playerStats[a].lastSolveTime == playerStats[b].lastSolveTime
        );
    }

    // -------------------------
    // NFT Claim
    // -------------------------

    function claimNFT() external {
        require(
            gameState == GameState.ENDED ||
            block.timestamp > (gameStartTimestamp + gameDuration),
            "Game not ended yet"
        );
        require(finalRank[msg.sender] > 0, "Rank not assigned yet. finalizeRanks first.");

        PlayerStats storage stats = playerStats[msg.sender];
        require(!stats.claimedNFT, "Already claimed NFT");

        stats.claimedNFT = true;
        _tokenIds++;
        uint256 newTokenId = _tokenIds;
        _safeMint(msg.sender, newTokenId);

        emit NFTClaimed(msg.sender, newTokenId, finalRank[msg.sender]);
    }

    // -------------------------
    // View / Utility
    // -------------------------

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function getPlayerCount() external view returns (uint256) {
        return allPlayers.length;
    }

    function timeLeft() external view returns (uint256) {
        if (gameState != GameState.ACTIVE) {
            return 0;
        }
        uint256 endTime = gameStartTimestamp + gameDuration;
        if (block.timestamp >= endTime) {
            return 0;
        }
        return endTime - block.timestamp;
    }
}
