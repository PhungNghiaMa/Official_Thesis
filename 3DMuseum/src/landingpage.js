// src/landingpage.js
import { initializeGame , stopGame } from "./game_logic";

// This variable needs to be accessible where initializeGame is called
// and checked. If gameInitialized is only used in this file, keep it here.
let gameInitialized = false;

// Export this function to be called from index.html
export function handleStartButtonClick() {
    // These elements should exist by the time this function is called
    const modelContainer = document.getElementById("model-container");
    // const loadingContainer = document.getElementById("loading-container"); // No longer directly controlled here

    const startButton = document.getElementById("start_button");
    const landingpage = document.getElementById("landingpage")

    if (!startButton) {
        // This error should ideally not be hit if handleStartButtonClick is called at the correct time
        console.error("Error: Start button not found in the DOM when handleStartButtonClick was called.");
        return;
    }

    startButton.addEventListener("click", () => {
        console.log("Start button clicked"); // This should now print!

        if (landingpage) {
            landingpage.style.display = "none"; // Hide the landing page when the game starts
        }

        // Corrected: modelContainer should be visible to display the game
        // if it's currently hidden. The condition was inverted before.
        if (modelContainer) {
            modelContainer.style.display = "block"; // Or "flex", depending on its intended layout for the game
        }

        // The loadingContainer visibility (showing/hiding) is managed by initializeGame (via loadModel in index.js)
        // So, we don't need to explicitly control its display state here.
        // Remove the previous conflicting lines:
        // if (!loadingContainer) { loadingContainer.style.display = "flex"; } else { loadingContainer.style.display = "none"; }

        if (!gameInitialized) {
            console.log("Initializing game...");
            initializeGame("model-container"); // Pass the ID of the container where the game will render
            gameInitialized = true; // Set to true after initialization
        } else {
            console.log("Game already initialized, stopping previous game...");
            stopGame();
            initializeGame("model-container");
        }
    });
}