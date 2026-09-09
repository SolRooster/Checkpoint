export { GENRES, PLANS, tiersFor, planLabel, genreLabel } from '../shared/taxonomy.js';

export const APPETITE = [
  { id: 'in', label: 'Into it', hint: 'Pull these toward us', weight: 2 },
  { id: 'ok', label: 'Fine', hint: 'No strong feeling', weight: 0 },
  { id: 'no', label: 'Hard pass', hint: 'Never draw this', weight: 0 },
];

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
