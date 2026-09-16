import { genreLabel, tiersFor, planLabel, onGamePass } from './taxonomy.js';

const RECENT_YEARS = 3;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Turn everyone's interests into the rules for this draw.
 * Vetoes are absolute; appetite only bends the odds.
 */
export function buildRules(members) {
  const vetoes = new Set();
  const loves = new Map();
  let recentVotes = 0;
  let coopVotes = 0;

  for (const m of members) {
    for (const [cat, value] of Object.entries(m.appetite || {})) {
      if (value === 'no') vetoes.add(cat);
      if (value === 'in') loves.set(cat, (loves.get(cat) || 0) + 1);
    }
    if (m.era === 'recent') recentVotes++;
    if (m.together === 'coop') coopVotes++;
  }

  return {
    memberCount: members.length,
    vetoes,
    loves,
    coopVotes,
    // Only Game Pass members can constrain a Game Pass catalog. Everyone else
    // still votes on genre, but sources their own copy.
    access: members.filter(onGamePass).map((m) => ({ player: m.player, plan: m.plan, tiers: tiersFor(m) })),
    offPlatform: members.filter((m) => !onGamePass(m)).map((m) => ({ player: m.player, plan: m.plan })),
    recentOnly: recentVotes > 0 && recentVotes === members.length,
  };
}

export const canPlay = (game, tiers) => game.tiers.some((t) => tiers.includes(t));

export const everyoneCanPlay = (game, rules) =>
  rules.access.every((member) => canPlay(game, member.tiers));

export function buildPool(games, rules) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_YEARS);

  return games.filter((g) => {
    if (!everyoneCanPlay(g, rules)) return false;
    if (g.cats.some((c) => rules.vetoes.has(c))) return false;
    if (rules.recentOnly) {
      if (!g.released) return false;
      if (new Date(g.released) < cutoff) return false;
    }
    return true;
  });
}

// Baseline 1 keeps every eligible game reachable; enthusiasm only tilts the odds.
export function weightOf(game, rules) {
  let weight = 1;
  for (const cat of game.cats) weight += (rules.loves.get(cat) || 0) * 2;
  if (rules.coopVotes && game.play?.coop) weight += rules.coopVotes * 2;
  return weight;
}

export function drawGame(pool, rules) {
  if (!pool.length) return null;

  const weights = pool.map((g) => weightOf(g, rules));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;

  let picked = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      picked = pool[i];
      break;
    }
  }

  return { game: picked, poolSize: pool.length, reasons: explain(picked, rules) };
}

function explain(game, rules) {
  const reasons = [];

  for (const cat of game.cats) {
    const fans = rules.loves.get(cat) || 0;
    if (fans > 0) reasons.push(`${plural(fans, 'person', 'people')} said they're into ${genreLabel(cat)}.`);
  }

  if (rules.coopVotes && game.play?.coop) {
    reasons.push(`${plural(rules.coopVotes, 'person', 'people')} wanted co-op \u2014 this one has it.`);
  }

  if (!reasons.length) {
    reasons.push("Nobody vetoed it and nobody asked for it \u2014 pure luck of the draw.");
  }
  if (rules.access.length) reasons.push('Everyone on Game Pass can already play it.');
  if (rules.offPlatform?.length) {
    reasons.push(
      `${rules.offPlatform.map((m) => m.player).join(', ')} \u2014 not on Game Pass, you'll need your own copy.`
    );
  }

  return reasons.slice(0, 5);
}

export function poolStats(games, rules) {
  const playable = games.filter((g) => everyoneCanPlay(g, rules));

  // Who is actually narrowing the pool, and by how much.
  const perMember = rules.access
    .map((m) => ({
      player: m.player,
      planLabel: planLabel(m.plan),
      reach: games.filter((g) => canPlay(g, m.tiers)).length,
    }))
    .sort((a, b) => a.reach - b.reach);

  return {
    playable: playable.length,
    blockedByAccess: games.length - playable.length,
    blockedByVeto: playable.filter((g) => g.cats.some((c) => rules.vetoes.has(c))).length,
    tightest: perMember[0] || null,
    perMember,
  };
}

// Trimmed shape stored as the cycle + sent to Discord.
export const slimGame = (game) => ({
  id: game.id,
  title: game.title,
  dev: game.dev,
  blurb: game.blurb,
  img: game.img,
  cats: game.cats,
  play: game.play,
  tiers: game.tiers,
});
