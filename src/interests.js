// Genres are the real category strings the Game Pass catalog uses, so steering
// maps 1:1 onto the actual pool. Verified live: 827 titles, these 16 categories.
export const GENRES = [
  { cat: 'Action & adventure', label: 'Action & Adventure' },
  { cat: 'Role playing', label: 'RPG' },
  { cat: 'Shooter', label: 'Shooter' },
  { cat: 'Simulation', label: 'Simulation' },
  { cat: 'Strategy', label: 'Strategy' },
  { cat: 'Platformer', label: 'Platformer' },
  { cat: 'Puzzle & trivia', label: 'Puzzle & Trivia' },
  { cat: 'Sports', label: 'Sports' },
  { cat: 'Racing & flying', label: 'Racing & Flying' },
  { cat: 'Fighting', label: 'Fighting' },
  { cat: 'Card & board', label: 'Card & Board' },
  { cat: 'Multi-player Online Battle Arena', label: 'MOBA' },
  { cat: 'Family & kids', label: 'Family & Kids' },
  { cat: 'Classics', label: 'Classics' },
  { cat: 'Music', label: 'Music' },
  { cat: 'Other', label: 'Other / Uncategorized' },
];

export const APPETITE = [
  { id: 'in', label: 'Into it', hint: 'Pull these toward us', weight: 2 },
  { id: 'ok', label: 'Fine', hint: 'No strong feeling', weight: 0 },
  { id: 'no', label: 'Hard pass', hint: 'Never draw this', weight: 0 },
];

// What matters for the draw is which catalog lists a person can reach.
// Ultimate covers console + PC; EA Play is asked separately so nobody's
// access is assumed on their behalf.
export const PLANS = [
  { id: 'ultimate', label: 'Game Pass Ultimate', hint: 'Console + PC', tiers: ['console', 'pc'] },
  { id: 'pc', label: 'PC Game Pass', hint: 'PC only', tiers: ['pc'] },
  { id: 'console', label: 'Console only', hint: 'Xbox, no PC', tiers: ['console'] },
];

export const tiersFor = (member) => {
  const plan = PLANS.find((p) => p.id === member?.plan) || PLANS[0];
  return member?.eaPlay ? [...plan.tiers, 'eaPlay'] : [...plan.tiers];
};

export const planLabel = (id) => PLANS.find((p) => p.id === id)?.label || id;

export const ERAS = [
  { id: 'any', label: 'Anything', hint: 'Old gems welcome' },
  { id: 'recent', label: 'Recent only', hint: 'Last ~3 years' },
];

// The catalog exposes real co-op/multiplayer flags, so this steer is data-backed.
export const TOGETHER = [
  { id: 'any', label: "Doesn't matter", hint: 'Solo is fine' },
  { id: 'coop', label: 'Prefer co-op', hint: 'Something we can play together' },
];

export const blankInterests = (player = '') => ({
  player,
  plan: 'ultimate',
  eaPlay: false,
  appetite: {},
  era: 'any',
  together: 'any',
  note: '',
});
