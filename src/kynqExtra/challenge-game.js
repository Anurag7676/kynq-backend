// The 7-Day Challenge's daily "game" step — reuses the same Would You
// Rather / This or That content as the live-call games (games.js), since
// both are naturally async (pick an answer, no timing requirement) unlike
// Tic Tac Toe or Guess the Word, which need both players connected in the
// same socket room at once.
import { randomWouldYouRather, randomThisOrThat } from "./games.js";

export function randomAsyncGamePrompt() {
  const type = Math.random() < 0.5 ? "would-you-rather" : "this-or-that";
  const prompt = type === "would-you-rather" ? randomWouldYouRather() : randomThisOrThat();
  return { type, prompt };
}
