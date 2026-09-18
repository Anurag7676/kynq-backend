// Conversation-prompt library for Kynq Extra — a categorized set of
// icebreaker questions a caller can drop into the shared chat thread
// (see chat-store.js's message `type`), distinct from the "Would You
// Rather" / "This or That" games (which have scored answers) — prompts
// are just a conversation aid with no game state.
export const PROMPT_CATEGORIES = ["icebreaker", "deep", "fun", "travel", "career", "random"];

const PROMPTS = {
  icebreaker: [
    "what's your name short for, or is it already short?",
    "where are you calling in from today?",
    "what's the last show you binge-watched?",
    "coffee or tea person?",
    "what's playing in your headphones lately?",
  ],
  deep: [
    "what's something you believed as a kid that you don't anymore?",
    "what's a piece of advice that actually changed how you live?",
    "what does a perfect ordinary day look like for you?",
    "what's something you're quietly proud of?",
    "if you could talk to yourself 10 years ago, what would you say?",
  ],
  fun: [
    "what's the most useless talent you have?",
    "what's a food combination you love that sounds wrong?",
    "if you had a theme song, what would it be?",
    "what's the weirdest thing you've googled this month?",
    "cereal before or after the milk?",
  ],
  travel: [
    "what's one place you'd move to tomorrow if you could?",
    "window or aisle seat?",
    "what's the best meal you've ever had while traveling?",
    "beach vacation or mountain trip?",
    "what's a place that surprised you more than you expected?",
  ],
  career: [
    "what did you want to be when you were a kid?",
    "what's a skill you're trying to learn right now?",
    "dream job, no constraints — what is it?",
    "what's the best piece of career advice you've gotten?",
    "do you have a side project you're excited about?",
  ],
  random: [
    "what's a movie you could rewatch forever?",
    "cats or dogs?",
    "what's your go-to karaoke song?",
    "what's something small that makes your day better?",
    "if you had an extra hour every day, what would you do with it?",
  ],
};

// A handful of prompts across every category — for the landing page.
export function samplePrompts(n = 6) {
  const all = PROMPT_CATEGORIES.flatMap((c) => (PROMPTS[c] ?? []).map((text) => ({ category: c, text })));
  for (let i = all.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, n);
}

export function getRandomPrompt(category) {
  const cat = PROMPT_CATEGORIES.includes(category) ? category : PROMPT_CATEGORIES[Math.floor(Math.random() * PROMPT_CATEGORIES.length)];
  const list = PROMPTS[cat];
  return { category: cat, text: list[Math.floor(Math.random() * list.length)] };
}
