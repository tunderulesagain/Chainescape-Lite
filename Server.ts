import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";

import { createAgent } from "./agent/createAgent.js";
import chainEscapeAbi from "./ChainEscapeAbi.json";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

let agent: Awaited<ReturnType<typeof createAgent>>;

// In-memory puzzle storage
let puzzleIdCounter = 0;
const puzzleSolutions: { [puzzleId: number]: string } = {};

// Initialize the agent
createAgent()
  .then((a) => {
    agent = a;
    console.log("Agent initialized successfully");
  })
  .catch((error) => {
    console.error("Failed to initialize agent:", error);
    process.exit(1);
  });

// Helper functions for answer verification
const normalizeAnswer = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '') // Remove non-alphanumeric characters
    .replace(/\s+/g, ' ')      // Collapse multiple spaces
    .trim();
};

const isNumericMatch = (guess: string, solution: string): boolean => {
  const extractNumbers = (str: string) => str.replace(/[^0-9]/g, '');
  const guessNums = extractNumbers(guess);
  const solutionNums = extractNumbers(solution);
  return guessNums !== '' && guessNums === solutionNums;
};

const wordsToNumbers = (str: string): string => {
  const numberWords: { [key: string]: string } = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    ten: '10', eleven: '11', twelve: '12', thirteen: '13',
    fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
    eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
    forty: '40', fifty: '50', sixty: '60', seventy: '70',
    eighty: '80', ninety: '90'
  };

  return str.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (match) => numberWords[match.toLowerCase()] || match
  );
};

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", agentReady: !!agent });
});

// Generate verifiable text endpoint
app.post("/api/generate", async (req, res) => {
  try {
    if (!agent) {
      return res.status(503).json({ error: "Agent not ready" });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log("Generating text for prompt:", prompt);
    const verifiableResp = await agent.generateVerifiableText(prompt);
    const resultText = verifiableResp.content;

    console.log("Generation result:", resultText);
    res.json({ text: resultText });
  } catch (error) {
    console.error("Error generating text:", error);
    res.status(500).json({
      error: "Failed to generate text",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Generate puzzle endpoint
app.post("/api/generatePuzzle", async (req, res) => {
  try {
    if (!agent) {
      return res.status(503).json({ error: "Agent not ready" });
    }

    const { difficulty, theme } = req.body;
    if (!difficulty || !theme) {
      return res.status(400).json({
        error: "Please provide 'difficulty' and 'theme' in the request body.",
      });
    }

    console.log(`Generating puzzle text for difficulty='${difficulty}', theme='${theme}'`);

    // Generate introduction
    const introPrompt = `
Create a 5-sentence introduction for an escape room puzzle game using the given theme: ${theme}. 
The intro should:
Establish why the user is trapped
Include a helpful voice/guide who explains the situation
Provide a clear, logical reason why solving puzzles leads to escape
Create urgency through a time pressure or threat
End by mentioning a puzzle interface (computer, ancient book, magical device, etc.)
Keep the tone intense but optimistic - the user should feel challenged, not hopeless. 
Use clear, accessible language and active voice. 
The guide should be an ally, not an antagonist.`;

    const puzzleIntroRes = await agent.generateVerifiableText(introPrompt);
    const puzzleIntro = puzzleIntroRes.content;

    // Generate puzzle text
    const puzzleTextRes = await agent.generateVerifiableText(
      `Create a unique, engaging puzzle that fits the following criteria:
  - **Theme:** ${theme}
  - **Difficulty:** ${difficulty}
  - **Length:** 2-5 sentences
  - **Type:** Logic Puzzle, Pattern Recognition, Cipher/Codebreaking, Math Challenge, or Word Riddle
  - **Requirements:** Self-contained, objective answer, clear wording`
    );
    const puzzleText = puzzleTextRes.content;

    // Generate solution
    const puzzleSolutionRes = await agent.generateVerifiableText(
      `Given this puzzle: "${puzzleText}", what's the correct solution?`
    );
    const puzzleSolution = puzzleSolutionRes.content;

    console.log("Puzzle solution is:", puzzleSolution);

    // Hash solution
    const puzzleHash = ethers.keccak256(ethers.toUtf8Bytes(puzzleSolution));

    // Connect to contract
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PUZZLE_CREATOR_KEY!, provider);
    const chainEscape = new ethers.Contract(
      process.env.CHAINESCAPE_ADDRESS!,
      chainEscapeAbi.abi,
      wallet
    );

    // Store puzzle
    const puzzleId = puzzleIdCounter++;
    const basePoints = 10;

    console.log(`Storing puzzle on-chain with puzzleId=${puzzleId}, puzzleHash=${puzzleHash}`);
    const tx = await chainEscape.setPuzzleHash(puzzleId, puzzleHash, basePoints);
    await tx.wait();

    console.log(`Puzzle stored successfully! TX hash: ${tx.hash}`);
    puzzleSolutions[puzzleId] = puzzleSolution;

    return res.json({
      puzzleId,
      puzzleIntro,
      puzzleText,
      puzzleHash,
      basePoints,
    });
  } catch (error) {
    console.error("Error generating puzzle:", error);
    return res.status(500).json({
      error: "Failed to generate puzzle",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Enhanced answer verification endpoint
app.post("/api/checkAnswer", async (req, res) => {
  try {
    const { username, puzzleId, userGuess } = req.body;
    if (!username || puzzleId === undefined || !userGuess) {
      return res.json({ correct: false, message: "Missing fields." });
    }

    const correctSolution = puzzleSolutions[puzzleId];
    if (!correctSolution) {
      return res.json({ correct: false, message: "Puzzle not found." });
    }

    // Normalize answers
    const cleanGuess = normalizeAnswer(wordsToNumbers(userGuess));
    const cleanSolution = normalizeAnswer(wordsToNumbers(correctSolution));

    // Check matches
    let isCorrect = cleanGuess === cleanSolution;
    
    // If not exact match, check numeric equivalence
    if (!isCorrect && isNumericMatch(cleanGuess, cleanSolution)) {
      isCorrect = true;
    }

    if (isCorrect) {
      return res.json({ correct: true, message: "Nice job!" });
    } else {
      return res.json({ 
        correct: false, 
        message: `Try again. Need: ${correctSolution} (You said: ${userGuess})`
      });
    }
  } catch (error) {
    console.error("Error checking answer:", error);
    return res.status(500).json({
      correct: false,
      message: "Error verifying answer.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log("Available endpoints:");
  console.log("  GET  /health");
  console.log("  POST /api/generate");
  console.log("  POST /api/generatePuzzle");
  console.log("  POST /api/checkAnswer");
});
