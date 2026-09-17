// Question bank for the 7-Day Challenge — when it's your turn to ask,
// the server offers 3 random unused-this-challenge questions to pick
// from (matches the reference flow's "pick one question" step).
export const CHALLENGE_QUESTIONS = [
  "what makes you happy on an ordinary day?",
  "what's something you're currently excited about?",
  "who has influenced you the most?",
  "what's a childhood memory you still remember clearly?",
  "what's something from your childhood you still miss?",
  "what's the best decision you've ever made?",
  "what do you do when you need to recharge?",
  "what's a place you'd love to go back to?",
  "what's something you're proud of that most people don't know?",
  "what does a perfect weekend look like for you?",
  "what's a habit you're trying to build?",
  "what's the last thing that made you laugh really hard?",
  "what's a small thing that always makes your day better?",
  "if you could master any skill instantly, what would it be?",
  "what's something you believed as a kid that turned out to be wrong?",
  "what's your favorite way to spend a rainy day?",
  "what's a book, show, or song that changed how you think?",
  "what's something you're looking forward to?",
  "what does your ideal morning look like?",
  "what's a compliment you received that you still think about?",
  "what's something you'd tell your younger self?",
  "what's a tradition you have (or wish you had)?",
  "what's the most spontaneous thing you've done?",
  "what's something you're currently learning?",
  "what's a moment you felt truly at peace?",
  "what's your comfort food?",
  "who's someone you admire and why?",
  "what's a goal you're working towards right now?",
  "what's something that always cheers you up?",
  "what's a memory that makes you smile every time?",
];

export function pickQuestionOptions(excludeUsed = [], count = 3) {
  const pool = CHALLENGE_QUESTIONS.filter((q) => !excludeUsed.includes(q));
  const source = pool.length >= count ? pool : CHALLENGE_QUESTIONS;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
