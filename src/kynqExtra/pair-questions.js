// "Question for you two" decks for Kynq Extra — during a call both people
// see the SAME question with 2–4 choices. Each person picks privately; once
// both have picked, both picks are revealed ("You: Chai · Them: Coffee") and
// they talk about why. Questions get deeper as the call goes on (level 1
// light → 2 personal → 3 friendship). The server picks the deck from the
// pair's self-declared genders (mixed = a girl and a boy, general =
// unknown/other); neither person is ever shown the other's gender. Every
// question is platonic and needs no identifying info.
export const PAIR_DECKS = ["mixed", "boys", "girls", "general"];
export const PAIR_LEVELS = [1, 2, 3];
export const MAX_OPTIONS = 4;

const Q = (q, ...options) => ({ q, options });

// Shared by every deck; each deck adds its own on top.
const COMMON = {
  1: [
    Q("Chai or coffee?", "Chai", "Coffee", "Both", "Neither"),
    Q("Midnight snack?", "Maggi", "Chips", "Leftovers", "Ice cream"),
    Q("Sweet or spicy?", "Sweet", "Spicy", "Both, together"),
    Q("Best part of a lazy Sunday?", "Sleeping in", "Bingeing a show", "Going out", "Family time"),
    Q("Monsoon rain?", "Love it", "Hate it", "Only from inside"),
    Q("Early bird or night owl?", "Early bird", "Night owl", "Depends on the day"),
    Q("Pick a weekend trip", "Mountains", "Beach", "City", "Stay home"),
    Q("Ghar ka khana ya bahar ka?", "Ghar ka", "Bahar ka", "Dono chahiye"),
    Q("Which app do you open most?", "Instagram", "YouTube", "WhatsApp", "Something else"),
    Q("Best festival food?", "Diwali sweets", "Holi gujiya", "Eid biryani", "Christmas cake"),
    Q("Movie night pick?", "Comedy", "Thriller", "Romance", "Horror"),
    Q("Music while studying or working?", "Always", "Never", "Only lo-fi"),
    Q("Train, flight or road trip?", "Train", "Flight", "Road trip"),
    Q("Pizza topping?", "Paneer", "Chicken", "Just cheese", "Pineapple 🍍"),
    Q("Calls or texts?", "Calls", "Texts", "Voice notes"),
    Q("Childhood cartoon?", "Doraemon", "Shinchan", "Tom & Jerry", "Pokémon"),
  ],
  2: [
    Q("A free day with zero plans, you'd…", "Learn something", "Sleep", "Meet friends", "Go explore alone"),
    Q("When stressed, you usually…", "Talk it out", "Go quiet", "Work out", "Eat something"),
    Q("Plans or spontaneous?", "Plan everything", "Go with the flow", "A bit of both"),
    Q("What would you rather be great at?", "Music", "Sports", "Art", "Coding"),
    Q("Your friends call you for…", "Advice", "Fun", "Food spots", "Help with work"),
    Q("Morning routine?", "Super organised", "Rush and run", "What routine?"),
    Q("A skill you'd learn in a month?", "A language", "Cooking", "An instrument", "Dancing"),
    Q("Group trip role?", "The planner", "The photographer", "The DJ", "The one who sleeps"),
    Q("Best way to unwind?", "Long walk", "Gaming", "Reading", "Scrolling"),
    Q("Argue for fun or avoid debates?", "Love a debate", "Avoid them", "Only close friends"),
    Q("Money spent best on…", "Travel", "Food", "Gadgets", "Clothes"),
    Q("Ideal job vibe?", "Own business", "Big company", "Creative freelance", "Still figuring out"),
    Q("You learn best by…", "Watching videos", "Reading", "Doing it", "Someone explaining"),
    Q("Social battery after a party?", "Charged up", "Totally drained", "Depends who was there"),
  ],
  3: [
    Q("What matters most in a friend?", "Honesty", "Loyalty", "Being fun", "Being there"),
    Q("When a friend is upset, you…", "Listen", "Give advice", "Distract them", "Give them space"),
    Q("You feel most like yourself with…", "Family", "Old friends", "New people", "Alone"),
    Q("Hardest thing to say out loud?", "Sorry", "I need help", "I'm proud of you", "No"),
    Q("What do you value more?", "Being respected", "Being liked", "Being understood"),
    Q("A good friend never forgets…", "Your birthday", "Your struggles", "Your inside jokes", "To check in"),
    Q("How do you show you care?", "Words", "Time", "Doing things", "Small gifts"),
    Q("Biggest life lesson so far came from…", "A failure", "A friend", "Family", "Moving somewhere new"),
    Q("Would you rather have…", "Few close friends", "Many good friends"),
    Q("Honest feedback from a friend?", "Always want it", "Only if I ask", "Be gentle please"),
    Q("What makes you trust someone?", "Keeping promises", "Being real", "Time", "How they treat others"),
    Q("Dosti mein sabse zaroori?", "Bharosa", "Mazaak", "Saath dena", "Sachai"),
    Q("A dream you'd want a friend's help with?", "Starting something", "Travelling", "Getting fit", "Learning a skill"),
    Q("You hope people remember you as…", "Kind", "Funny", "Smart", "Dependable"),
  ],
};

const EXTRA = {
  mixed: {
    1: [
      Q("Shopping: quick or explore every shop?", "In and out", "Explore everything", "Online only"),
      Q("Best mood-lifter song genre?", "Bollywood", "Punjabi", "English pop", "Indie"),
      Q("Who's the better cook at home?", "Mom", "Dad", "Me", "Nobody 😅"),
      Q("Dance at a wedding?", "First on the floor", "After some convincing", "Never"),
    ],
    2: [
      Q("Siblings: blessing or chaos?", "Blessing", "Chaos", "Both", "I'm an only child"),
      Q("Who do you go to for advice first?", "Parents", "Best friend", "Sibling", "Google"),
      Q("Your hostel/room is…", "Spotless", "Organised chaos", "Don't ask"),
    ],
    3: [
      Q("Best thing about a friend of the opposite gender?", "Different view", "Honest advice", "Easy to talk to", "No drama"),
      Q("What breaks a friendship fastest?", "Lying", "Ignoring", "Gossip", "Jealousy"),
    ],
  },
  boys: {
    1: [
      Q("Cricket or football?", "Cricket", "Football", "Neither", "Both"),
      Q("Best game to play with friends?", "BGMI", "Valorant", "FIFA", "Ludo"),
      Q("Gym or sports?", "Gym", "Sports", "Neither, sleep"),
      Q("Bike or car?", "Bike", "Car", "Metro wins"),
    ],
    2: [
      Q("Your squad's plan usually is…", "Chai and chill", "Gaming night", "Random ride", "Cancelled last minute"),
      Q("Hardest to give up for a month?", "Phone", "Junk food", "Gaming", "Gym"),
      Q("Best advice from your dad or an elder?", "Work hard", "Save money", "Respect people", "Stay calm"),
    ],
    3: [
      Q("Do guys talk enough about feelings?", "Not at all", "Getting better", "Yes, with close ones"),
      Q("Real bro move?", "Showing up", "Keeping secrets", "Calling you out", "Lending money"),
    ],
  },
  girls: {
    1: [
      Q("Comfort outfit?", "Kurta", "Hoodie", "Pyjamas", "Whatever's clean"),
      Q("Best girls' night?", "Movie marathon", "Dinner out", "Makeover", "Long talks"),
      Q("Go-to street food?", "Pani puri", "Momos", "Chaat", "Vada pav"),
      Q("Skincare routine?", "10 steps", "Just basics", "Water and vibes"),
    ],
    2: [
      Q("Your friend group's planner is…", "Me", "Someone else", "Nobody, chaos"),
      Q("Hardest to give up for a month?", "Phone", "Sweets", "Shopping", "Coffee"),
      Q("Best advice from your mom or an elder?", "Be independent", "Save money", "Trust yourself", "Be kind"),
    ],
    3: [
      Q("What makes a friend feel safe?", "No judging", "Keeping secrets", "Hyping you up", "Honesty"),
      Q("Real friend move?", "Showing up", "Hype-woman energy", "Calling you out", "Midnight calls"),
    ],
  },
  general: { 1: [], 2: [], 3: [] },
};

export const PAIR_QUESTIONS = Object.fromEntries(
  PAIR_DECKS.map((d) => [d, Object.fromEntries(PAIR_LEVELS.map((l) => [l, [...COMMON[l], ...EXTRA[d][l]]]))]),
);

// Random question from deck+level whose text isn't in `exclude`; falls back to
// any in that level if all are excluded. Unknown deck → "general"; level clamped to 1..3.
export function pickPairQuestion(deck, level, exclude = new Set()) {
  const d = PAIR_DECKS.includes(deck) ? deck : "general";
  const n = Math.round(Number(level));
  const lvl = Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1;
  const list = PAIR_QUESTIONS[d][lvl];
  const fresh = exclude && exclude.size ? list.filter((x) => !exclude.has(x.q)) : list;
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
