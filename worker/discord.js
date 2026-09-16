/**
 * Discord bot surface: signature verification, command registration, interactions.
 * Reuses the same draw engine and KV store as the web app.
 */

import { STATES, SPOILERS, getState } from '../shared/states.js';
import { buildRules, buildPool, drawGame, slimGame } from '../shared/draw.js';
import { planLabel, genreLabel } from '../shared/taxonomy.js';

const API = 'https://discord.com/api/v10';
const APP_URL = 'https://solrooster.github.io/Checkpoint/';

// A personal link carries who you are, so nobody has to type their name and
// risk creating a second copy of themselves.
const LINK_TTL = 60 * 60 * 24 * 30;

// Bump when the command list changes so the Worker re-registers them.
export const COMMANDS_VERSION = 3;

const MANAGE_GUILD = '32';

export const PONG = { type: 1 };
const MESSAGE = 4;
const DEFERRED = 5;
const EPHEMERAL = 64;

const reply = (content, flags = 0) => ({ type: MESSAGE, data: { content, flags } });
const embedReply = (embeds, content) => ({ type: MESSAGE, data: { content, embeds } });

const hex2bytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

export async function verifyRequest(request, body, publicKey) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp || !publicKey) return false;

  try {
    const key = await crypto.subtle.importKey('raw', hex2bytes(publicKey), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hex2bytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch {
    return false;
  }
}

const COMMANDS = [
  {
    name: 'draw',
    description: 'Draw this cycle\u2019s game. Binding, one shot, posts here.',
    default_member_permissions: MANAGE_GUILD,
  },
  { name: 'status', description: 'What are we playing, and who has checked in?' },
  { name: 'interests', description: 'Set what you\u2019re into so the draw can steer' },
  {
    name: 'checkin',
    description: 'Say where you\u2019re at with this cycle\u2019s game',
    options: [
      {
        name: 'state',
        description: 'Where are you at?',
        type: 3,
        required: true,
        choices: STATES.map((s) => ({ name: `${s.label} \u2014 ${s.tag}`, value: s.id })),
      },
      { name: 'hours', description: 'Hours played so far', type: 10, required: false },
      { name: 'far', description: 'How far did you get?', type: 3, required: false },
      { name: 'take', description: 'Your take in one line', type: 3, required: false },
      {
        name: 'spoilers',
        description: 'How should we talk to you?',
        type: 3,
        required: false,
        choices: SPOILERS.map((s) => ({ name: s.label, value: s.id })),
      },
    ],
  },
];

export async function ensureCommands(env) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APP_ID) return;

  const stamped = await env.CLUB.get('commands:version');
  if (stamped === String(COMMANDS_VERSION)) return;

  const res = await fetch(`${API}/applications/${env.DISCORD_APP_ID}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });

  if (res.ok) await env.CLUB.put('commands:version', String(COMMANDS_VERSION));
}

const optionMap = (interaction) =>
  Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));

const displayName = (interaction) =>
  interaction.member?.nick ||
  interaction.member?.user?.global_name ||
  interaction.member?.user?.username ||
  interaction.user?.global_name ||
  interaction.user?.username ||
  'someone';

function pickEmbed(cycle) {
  return {
    title: cycle.game.title,
    description: cycle.reasons.join('\n') || undefined,
    color: 0xf5b942,
    thumbnail: cycle.game.img ? { url: cycle.game.img } : undefined,
    fields: [
      { name: 'On', value: cycle.game.tiers.join(', ') || 'Game Pass', inline: true },
      { name: 'Genre', value: cycle.game.cats.join(', ') || '\u2014', inline: true },
      { name: 'Drawn from', value: `${cycle.poolSize} eligible games`, inline: true },
    ],
    footer: { text: 'Play as much or as little as you want.' },
  };
}

async function followUp(env, interaction, payload) {
  await fetch(`${API}/webhooks/${env.DISCORD_APP_ID}/${interaction.token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function runDraw(env, interaction, deps) {
  const existing = await env.CLUB.get('cycle:current');
  if (existing) {
    const cycle = JSON.parse(existing);
    return followUp(env, interaction, {
      content: `We already drew this cycle \u2014 **${cycle.game.title}**, by ${cycle.drawnBy}. Close the cycle before drawing again.`,
    });
  }

  const catalog = await deps.getCatalog();
  if (!catalog) return followUp(env, interaction, { content: 'Could not reach the Game Pass catalog.' });

  const members = await deps.readInterests(env);
  const rules = buildRules(members);
  const pool = buildPool(catalog.games, rules);
  if (!pool.length) {
    return followUp(env, interaction, {
      content: 'Nothing everyone can play right now \u2014 the vetoes are too tight.',
    });
  }

  const result = drawGame(pool, rules);
  const cycle = {
    game: slimGame(result.game),
    poolSize: result.poolSize,
    reasons: result.reasons,
    drawnBy: displayName(interaction),
    drawnAt: new Date().toISOString(),
  };
  await env.CLUB.put('cycle:current', JSON.stringify(cycle));

  await followUp(env, interaction, {
    content: `**The wheel has spoken.** ${cycle.drawnBy} drew this cycle\u2019s game \u2014 one shot, no rerolls:`,
    embeds: [pickEmbed(cycle)],
  });
}

async function statusReply(env, deps) {
  const raw = await env.CLUB.get('cycle:current');
  const members = await deps.readInterests(env);

  if (!raw) {
    const catalog = await deps.getCatalog();
    const rules = buildRules(members);
    const pool = catalog ? buildPool(catalog.games, rules) : [];

    const lines = [
      '**No game drawn yet.**',
      `${members.length} ${members.length === 1 ? 'person has' : 'people have'} set interests: ${members.map((m) => m.player).join(', ') || '\u2014'}`,
      catalog ? `${pool.length} games are eligible right now.` : '',
      rules.offPlatform.length
        ? `Not on Game Pass: ${rules.offPlatform.map((m) => m.player).join(', ')}`
        : '',
    ].filter(Boolean);
    return reply(lines.join('\n'));
  }

  const cycle = JSON.parse(raw);
  const checkins = await deps.readCheckins(env, cycle.drawnAt);
  const byState = STATES.map((s) => {
    const who = checkins.filter((c) => c.state === s.id);
    return who.length ? `**${s.label}** \u2014 ${who.map((c) => c.player).join(', ')}` : null;
  }).filter(Boolean);

  const missing = members.filter((m) => !checkins.some((c) => c.player === m.player));

  return embedReply([pickEmbed(cycle)], [
    byState.length ? byState.join('\n') : '_Nobody has checked in yet._',
    missing.length ? `\nStill quiet: ${missing.map((m) => m.player).join(', ')}` : '',
  ].join('\n'));
}

async function runCheckin(env, interaction, deps) {
  const raw = await env.CLUB.get('cycle:current');
  if (!raw) return reply('No game has been drawn yet \u2014 nothing to check in against.', EPHEMERAL);

  const cycle = JSON.parse(raw);
  const opts = optionMap(interaction);
  const state = getState(opts.state);
  const player = displayName(interaction);

  const record = {
    player,
    userId: interaction.member?.user?.id || interaction.user?.id || null,
    state: state.id,
    hours: typeof opts.hours === 'number' ? opts.hours : null,
    far: opts.far || '',
    take: opts.take || '',
    spoilers: opts.spoilers || 'mine',
    at: new Date().toISOString(),
  };
  await deps.saveCheckin(env, cycle.drawnAt, record);

  const fields = [];
  if (record.hours !== null) fields.push({ name: 'Time played', value: `${record.hours} hrs`, inline: true });
  if (record.far) fields.push({ name: 'Got as far as', value: record.far, inline: true });
  fields.push({
    name: 'Spoilers',
    value: SPOILERS.find((s) => s.id === record.spoilers)?.label || 'Up to my point',
    inline: true,
  });
  if (record.take) fields.push({ name: 'Their take', value: record.take, inline: false });

  return embedReply([
    {
      title: `${player} \u2014 ${state.label} \u00b7 ${state.tag}`,
      description: state.blurb,
      color: parseInt(state.accent.slice(1), 16),
      fields,
      footer: { text: cycle.game.title },
    },
  ]);
}

function interestsSummary(me) {
  if (!me) return null;

  const picks = (want) =>
    Object.entries(me.appetite || {})
      .filter(([, v]) => v === want)
      .map(([c]) => genreLabel(c));

  const into = picks('in');
  const passes = picks('no');

  return [
    `**Access** \u2014 ${planLabel(me.plan)}${me.eaPlay ? ' + EA Play' : ''}`,
    `**Into** \u2014 ${into.length ? into.join(', ') : 'nothing flagged'}`,
    `**Hard passes** \u2014 ${passes.length ? passes.join(', ') : 'none'}`,
    `**Age** \u2014 ${me.era === 'recent' ? 'recent releases only' : 'anything'}`,
    `**Together** \u2014 ${me.together === 'coop' ? 'prefers co-op' : "doesn't matter"}`,
    me.note ? `**Note** \u2014 ${me.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function interestsReply(env, interaction, deps) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const name = displayName(interaction);

  const token = crypto.randomUUID().replace(/-/g, '');
  await env.CLUB.put(`link:${token}`, JSON.stringify({ userId, name }), {
    expirationTtl: LINK_TTL,
  });

  const members = await deps.readInterests(env);
  const me =
    members.find((m) => m.userId && m.userId === userId) ||
    members.find((m) => m.player.toLowerCase() === name.toLowerCase());

  const summary = interestsSummary(me);
  const link = `${APP_URL}?k=${token}`;

  const body = me
    ? `**Your interests, ${me.player}:**\n${summary}\n\n[Open your settings](${link}) \u2014 this link is yours, so it edits your entry instead of making a new one.`
    : `You haven't set your interests yet, so the draw can't account for you.\n\n[Set them here](${link}) \u2014 this link is yours; your name is filled in automatically.`;

  return reply(body, EPHEMERAL);
}

export async function handleInteraction(interaction, env, ctx, deps) {
  if (interaction.type === 1) return PONG;
  if (interaction.type !== 2) return reply('Unsupported interaction.', EPHEMERAL);

  const name = interaction.data.name;

  if (name === 'draw') {
    ctx.waitUntil(runDraw(env, interaction, deps));
    return { type: DEFERRED };
  }
  if (name === 'status') return statusReply(env, deps);
  if (name === 'checkin') return runCheckin(env, interaction, deps);
  if (name === 'interests') return interestsReply(env, interaction, deps);

  return reply('Unknown command.', EPHEMERAL);
}
