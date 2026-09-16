// Every state is a legitimate place to stop. That's the whole point of the club.
// `asks` controls which context fields appear after you pick a state.

export const STATES = [
  {
    id: 'curious',
    label: 'Curious',
    tag: 'On my radar',
    blurb: "Haven't started. Might, might not. No promises made.",
    accent: '#8b93a7',
    asks: [],
  },
  {
    id: 'queued',
    label: 'Queued',
    tag: 'Got it, not started',
    blurb: "It's installed/owned and waiting. Intent without a deadline.",
    accent: '#6cb8ff',
    asks: [],
  },
  {
    id: 'playing',
    label: 'Playing',
    tag: 'In it right now',
    blurb: "Actively in it. Still forming an opinion.",
    accent: '#4ade80',
    asks: ['hours', 'marker', 'take'],
  },
  {
    id: 'called-it',
    label: 'Called It',
    tag: 'I got what I needed',
    blurb:
      "You played enough to have a real take, and you're done. Not a quit \u2014 a finish line you drew yourself.",
    accent: '#f5b942',
    featured: true,
    asks: ['hours', 'marker', 'take'],
  },
  {
    id: 'bounced',
    label: 'Bounced',
    tag: 'Not my cup of tea',
    blurb: "It didn't land. Say why \u2014 that's one of the most useful takes in the room.",
    accent: '#ff7b6b',
    asks: ['hours', 'marker', 'take'],
  },
  {
    id: 'credits',
    label: 'Rolled Credits',
    tag: 'Saw it through',
    blurb: 'Finished the thing. You have the long view.',
    accent: '#c084fc',
    asks: ['hours', 'take'],
  },
  {
    id: 'veteran',
    label: 'Been There',
    tag: 'Played it before',
    blurb: 'Not replaying, but you know this game. Joining on memory.',
    accent: '#7dd3c0',
    asks: ['take'],
  },
  {
    id: 'spectating',
    label: 'Spectating',
    tag: 'Here for the talk',
    blurb: "Not playing at all, still showing up to listen. Completely allowed.",
    accent: '#a0a6b8',
    asks: [],
  },
];

// Because everyone stops at a different point, spoiler tolerance is per-person.
export const SPOILERS = [
  { id: 'none', label: 'Keep me clean', hint: 'Nothing past where I am' },
  { id: 'mine', label: 'Up to my point', hint: "Anything I've already seen" },
  { id: 'all', label: 'Spoil freely', hint: "I don't care, go wild" },
];

export const HOUR_CHIPS = [1, 2, 5, 10, 20, 40];

export const getState = (id) => STATES.find((s) => s.id === id);
