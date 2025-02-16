import React, { useState } from "react";
import axios from "axios";

function App() {
  // Basic puzzle generation inputs
  const [difficulty, setDifficulty] = useState("easy");
  const [theme, setTheme] = useState("animals");

  // Data returned by /api/generatePuzzle
  const [puzzleData, setPuzzleData] = useState(null);

  // For error messages
  const [errorMessage, setErrorMessage] = useState("");

  // Track username, guess, and feedback
  const [username, setUsername] = useState("");
  const [userGuess, setUserGuess] = useState("");
  const [feedback, setFeedback] = useState("");

  // Local points state
  const [points, setPoints] = useState(0);

  // Generate a new puzzle
  const handleGeneratePuzzle = async () => {
    try {
      setErrorMessage("");
      setFeedback("");
      setUserGuess("");
      // Reset points to 100 for each new puzzle
      setPoints(100);

      // Call your Node server at http://localhost:3000/api/generatePuzzle
      const res = await axios.post("http://localhost:3000/api/generatePuzzle", {
        difficulty,
        theme,
      });
      setPuzzleData(res.data);
    } catch (err) {
      console.error("Error generating puzzle:", err);
      setErrorMessage("Failed to generate puzzle. Check console for details.");
    }
  };

  // Submit an answer guess
  const handleSubmitGuess = async () => {
    if (!puzzleData) {
      return alert("No puzzle generated yet!");
    }
    if (!username) {
      return alert("Please enter a username first.");
    }

    try {
      const res = await axios.post("http://localhost:3000/api/checkAnswer", {
        username,
        puzzleId: puzzleData.puzzleId,
        userGuess,
      });

      if (res.data.correct) {
        // Correct => +25 points
        setPoints((prev) => prev + 25);
        setFeedback("Correct! " + (res.data.message || ""));
      } else {
        // Wrong => -5 points
        setPoints((prev) => prev - 5);
        setFeedback("Wrong answer. " + (res.data.message || ""));
      }
    } catch (err) {
      console.error("Error submitting guess:", err);
      setFeedback("Error verifying guess. See console.");
    }
  };

  // Skip the puzzle => -15 points, remove puzzle
  const handleSkipPuzzle = () => {
    if (!puzzleData) {
      return alert("No puzzle to skip!");
    }
    // Deduct 15 points
    setPoints((prev) => prev - 15);
    // Clear puzzle and feedback
    setPuzzleData(null);
    setFeedback("You skipped the puzzle. -15 points.");
  };

  return (
    // Main container with a simple background
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: 20,
        background: "linear-gradient(to right, #a1c4fd, #c2e9fb)",
        fontFamily: "Verdana, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          backgroundColor: "rgba(255,255,255,0.85)",
          borderRadius: 8,
          boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
          padding: 20,
        }}
      >
        <h1 style={{ textAlign: "center", marginBottom: 20 }}>
          ChainEscape Lite: Puzzle Generator
        </h1>

        {/* Username Field */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ marginRight: 5 }}>Username:</label>
          <input
            style={{
              padding: "5px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        {/* Difficulty & Theme Fields */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ marginRight: 5 }}>Difficulty:</label>
          <input
            style={{
              padding: "5px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ marginRight: 5 }}>Theme:</label>
          <input
            style={{
              padding: "5px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>

        {/* Generate Puzzle Button */}
        <button
          onClick={handleGeneratePuzzle}
          style={{
            padding: "8px 16px",
            borderRadius: 4,
            border: "none",
            backgroundColor: "#4CAF50",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Generate Puzzle
        </button>

        {/* Error Message */}
        {errorMessage && (
          <div
            style={{
              marginTop: 20,
              color: "red",
              fontWeight: "bold",
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Puzzle Display */}
        {puzzleData && (
          <div
            style={{
              marginTop: 20,
              backgroundColor: "#f9f9f9",
              borderRadius: 6,
              padding: 15,
              border: "1px solid #eee",
            }}
          >
            {/* Show the introduction above the puzzle, if present */}
            {puzzleData.puzzleIntro && (
              <div
                style={{
                  marginBottom: 20,
                  whiteSpace: "pre-wrap",
                  fontStyle: "italic",
                  color: "#555",
                }}
              >
                <strong>Introduction:</strong> {puzzleData.puzzleIntro}
              </div>
            )}

            {/* Show current points */}
            <p style={{ fontWeight: "bold", marginBottom: 5 }}>
              Points: {points}
            </p>

            <h2 style={{ margin: "0.5em 0" }}>
              Puzzle ID: {puzzleData.puzzleId}
            </h2>
            <p>
              <strong>Puzzle Text:</strong> {puzzleData.puzzleText}
            </p>
            <p>
              <strong>Hash:</strong> {puzzleData.puzzleHash}
            </p>
            <p>
              <strong>Base Points:</strong> {puzzleData.basePoints}
            </p>

            {/* Guess Input & Submit Button */}
            <div style={{ marginTop: 20 }}>
              <label style={{ marginRight: 5 }}>Your Guess:</label>
              <input
                style={{
                  padding: "5px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  marginRight: "5px",
                }}
                value={userGuess}
                onChange={(e) => setUserGuess(e.target.value)}
              />
              <button
                onClick={handleSubmitGuess}
                style={{
                  backgroundColor: "#2196F3",
                  color: "#fff",
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  marginRight: 10,
                }}
              >
                Submit Guess
              </button>
              {/* Skip button */}
              <button
                onClick={handleSkipPuzzle}
                style={{
                  backgroundColor: "#FF5722",
                  color: "#fff",
                  padding: "6px 12px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Skip Puzzle
              </button>
            </div>

            {/* Feedback on correctness */}
            {feedback && (
              <p style={{ color: "blue", marginTop: 10 }}>{feedback}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
