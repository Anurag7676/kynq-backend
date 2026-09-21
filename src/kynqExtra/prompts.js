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
    "what brought you here tonight?",
    "morning person or night owl — be honest.",
    "what's the best thing that happened to you this week?",
    "what are you eating or drinking right now?",
    "what's the weather like where you are?",
    "what's the first thing you do when you wake up?",
    "what's your phone wallpaper right now?",
    "how's your day going, on a scale of 1 to a really good biryani?",
    "what were you doing right before this call?",
    "what would you be doing right now if you weren't on this call?",
    "what's the last thing you searched for?",
  ],
  deep: [
    "what's something you believed as a kid that you don't anymore?",
    "what's a piece of advice that actually changed how you live?",
    "what does a perfect ordinary day look like for you?",
    "what's something you're quietly proud of?",
    "if you could talk to yourself 10 years ago, what would you say?",
    "what's a fear you've slowly gotten over?",
    "who's someone that changed how you see the world?",
    "what do you wish more people asked you about?",
    "what's a decision you almost didn't make that turned out right?",
    "what does home mean to you?",
    "what would you do if you knew nobody would judge you?",
    "what's the kindest thing a stranger has done for you?",
    "what's something you believe that most people around you disagree with?",
    "what's a small habit that made your life better?",
    "when do you feel most like yourself?",
    "what's something you're still figuring out?",
  ],
  fun: [
    "what's the most useless talent you have?",
    "what's a food combination you love that sounds wrong?",
    "if you had a theme song, what would it be?",
    "what's the weirdest thing you've googled this month?",
    "cereal before or after the milk?",
    "which superpower would be the most inconvenient to have?",
    "what's a hill you'll die on that's completely unimportant?",
    "which fictional world would you live in for a week?",
    "what's the worst haircut you've ever had?",
    "if you were a snack, which one would you be and why?",
    "what's your most irrational fear?",
    "pineapple on pizza — final verdict?",
    "what's the funniest thing you've seen at a wedding?",
    "if you could only speak in movie quotes for a day, which movie?",
    "what would your villain origin story be?",
    "what's the most embarrassing song you know every word to?",
  ],
  travel: [
    "what's one place you'd move to tomorrow if you could?",
    "window or aisle seat?",
    "what's the best meal you've ever had while traveling?",
    "beach vacation or mountain trip?",
    "what's a place that surprised you more than you expected?",
    "what's a city you'd go back to a hundred times?",
    "what's a travel mishap that turned into a great story?",
    "train, bus, flight or road trip — pick one for life.",
    "what's the most beautiful place you've ever seen?",
    "what's on your travel list that you keep postponing?",
    "what's one thing you always pack that other people forget?",
    "what's a local food from your city that everyone should try?",
    "if you could teleport anywhere for one weekend, where would you go?",
    "what's a place you'd never go back to?",
    "solo trip or trip with friends?",
    "what's the best thing about where you live?",
  ],
  career: [
    "what did you want to be when you were a kid?",
    "what's a skill you're trying to learn right now?",
    "dream job, no constraints — what is it?",
    "what's the best piece of career advice you've gotten?",
    "do you have a side project you're excited about?",
    "what's the most useful thing you learned outside a classroom?",
    "what does a good day at work or college look like for you?",
    "what would you do if money wasn't a factor?",
    "what's a job or subject you thought you'd hate but ended up liking?",
    "who would you love to have as a mentor?",
    "what's a mistake you learned the most from?",
    "how do you switch off after a stressful day?",
    "what could you talk about for an hour without any notes?",
    "what's a career you'd love to try for a year?",
    "what's the best team you've ever been part of?",
    "what do you want to have built five years from now?",
  ],
  random: [
    "what's a movie you could rewatch forever?",
    "cats or dogs?",
    "what's your go-to karaoke song?",
    "what's something small that makes your day better?",
    "if you had an extra hour every day, what would you do with it?",
    "what's the last thing you bought that you were really happy about?",
    "what's the best gift you've ever received?",
    "if you could instantly master one instrument, which one?",
    "what's your comfort food when everything's going wrong?",
    "what's the best app on your phone that isn't social media?",
    "what's a song you'll never get tired of?",
    "what's the last thing that made you laugh out loud?",
    "unlimited data or unlimited chai — one, forever?",
    "what's your favourite season and why?",
    "what's a family tradition you love?",
    "what's something you own that you'd save in a fire?",
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
