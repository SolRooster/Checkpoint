// Pure data shared by the browser and the Worker.

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

export const genreLabel = (cat) => GENRES.find((g) => g.cat === cat)?.label || cat;
