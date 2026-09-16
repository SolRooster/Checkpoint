/**
 * Checkpoint Worker — catalog gateway, interest store, draw recorder, Discord relay.
 *
 * Bindings:
 *   DISCORD_WEBHOOK_URL  Secret
 *   ALLOWED_ORIGIN       Text, comma-separated origins
 *   CLUB                 KV namespace (interests + current cycle)
 */

import { buildCatalog } from '../shared/catalog.js';
import { buildRules, buildPool, drawGame, slimGame } from '../shared/draw.js';
import { PLANS } from '../shared/taxonomy.js';
import { verifyRequest, handleInteraction, ensureCommands } from './discord.js';

const CATALOG_TTL = 60 * 60 * 12;

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

const clip = (v, n) => String(v ?? '').slice(0, n).trim();

function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function getCatalogCached(ctx) {
  const cacheKey = new Request('https://checkpoint.internal/catalog');
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return { body: await hit.text(), cached: true };

  const catalog = await buildCatalog();
  if (!catalog.count) return null;

  const body = JSON.stringify(catalog);
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_TTL}` },
      })
    )
  );
  return { body, cached: false };
}

async function handleCatalog(ctx, cors) {
  const catalog = await getCatalogCached(ctx);
  if (!catalog) return json({ error: 'Catalog came back empty' }, 502, cors);
  return new Response(catalog.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// KV list is eventually consistent, so a fresh save can be missing from it for a
// while. The draw reads this single aggregate key instead; per-player keys stay
// as the source of truth to rebuild from.
const ALL_KEY = 'interests:all';

async function rebuildInterests(env) {
  const list = await env.CLUB.list({ prefix: 'interest:' });
  const members = [];
  for (const key of list.keys) {
    const raw = await env.CLUB.get(key.name);
    if (raw) members.push(JSON.parse(raw));
  }
  await env.CLUB.put(ALL_KEY, JSON.stringify(members));
  return members;
}

async function readInterests(env) {
  const raw = await env.CLUB.get(ALL_KEY);
  if (raw) return JSON.parse(raw);
  return rebuildInterests(env);
}

async function saveInterest(env, record) {
  await env.CLUB.put(`interest:${record.player.toLowerCase()}`, JSON.stringify(record));

  const members = await readInterests(env);
  const next = members.filter((m) => m.player.toLowerCase() !== record.player.toLowerCase());
  next.push(record);
  await env.CLUB.put(ALL_KEY, JSON.stringify(next));
  return next;
}

const readLink = async (env, token) => {
  if (!token || !env.CLUB) return null;
  const raw = await env.CLUB.get(`link:${clip(token, 64)}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.userId && parsed?.name ? parsed : null;
  } catch {
    return null;
  }
};

const findMember = (members, identity) =>
  members.find((m) => m.userId && m.userId === identity.userId) ||
  members.find((m) => m.player.toLowerCase() === identity.name.toLowerCase());

// A linked save replaces whatever that Discord user saved before, even if they
// renamed themselves, so one person can never become two entries.
async function saveLinkedInterest(env, record, identity) {
  const members = await readInterests(env);
  const previous = findMember(members, identity);

  if (previous && previous.player.toLowerCase() !== record.player.toLowerCase()) {
    await env.CLUB.delete(`interest:${previous.player.toLowerCase()}`);
  }

  const merged = { ...record, userId: identity.userId };
  await env.CLUB.put(`interest:${merged.player.toLowerCase()}`, JSON.stringify(merged));

  const next = members.filter(
    (m) =>
      !(m.userId && m.userId === identity.userId) &&
      m.player.toLowerCase() !== merged.player.toLowerCase() &&
      (!previous || m.player.toLowerCase() !== previous.player.toLowerCase())
  );
  next.push(merged);
  await env.CLUB.put(ALL_KEY, JSON.stringify(next));
  return next;
}

// Check-ins are grouped per cycle so a redraw starts everyone fresh.
const checkinKey = (cycleId) => `checkins:${cycleId}`;

async function readCheckins(env, cycleId) {
  const raw = await env.CLUB.get(checkinKey(cycleId));
  return raw ? JSON.parse(raw) : [];
}

async function saveCheckin(env, cycleId, record) {
  const all = await readCheckins(env, cycleId);
  const next = all.filter((c) => c.player.toLowerCase() !== record.player.toLowerCase());
  next.push(record);
  await env.CLUB.put(checkinKey(cycleId), JSON.stringify(next));
  return next;
}

function normalizeInterests(body) {
  const player = clip(body.player, 60);
  if (!player) return null;

  const appetite = {};
  for (const [cat, value] of Object.entries(body.appetite || {})) {
    if (value === 'in' || value === 'no') appetite[clip(cat, 60)] = value;
  }

  // Validate against the shared plan list, never a copy of it.
  const plan = PLANS.some((p) => p.id === body.plan) ? body.plan : 'ultimate';

  return {
    player,
    plan,
    eaPlay: !!body.eaPlay,
    appetite,
    era: body.era === 'recent' ? 'recent' : 'any',
    together: body.together === 'coop' ? 'coop' : 'any',
    note: clip(body.note, 200),
    userId: body.userId || null,
    updated: new Date().toISOString(),
  };
}

async function postToDiscord(env, payload) {
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Checkpoint', ...payload }),
  });
  return res.ok;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const cors = corsHeaders(origin, allowed);
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Commands have to exist before anyone can invoke one, so register on any
    // request rather than waiting for an interaction. Guarded by a KV version.
    if (env.DISCORD_BOT_TOKEN && env.CLUB) ctx.waitUntil(ensureCommands(env));

    // Discord signs its own requests, so the browser CORS rules don't apply here.
    if (path === '/interactions' && request.method === 'POST') {
      const body = await request.text();
      const ok = await verifyRequest(request, body, env.DISCORD_PUBLIC_KEY);
      if (!ok) return new Response('Bad signature', { status: 401 });

      const interaction = JSON.parse(body);

      const result = await handleInteraction(interaction, env, ctx, {
        getCatalog: async () => {
          const cached = await getCatalogCached(ctx);
          return cached ? JSON.parse(cached.body) : null;
        },
        readInterests,
        readCheckins,
        saveCheckin,
      });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (origin && !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);

    if (path === '/catalog' && request.method === 'GET') return handleCatalog(ctx, cors);

    if (path === '/interests' && request.method === 'GET') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      return json({ members: await readInterests(env) }, 200, cors);
    }

    if (path === '/me' && request.method === 'GET') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const identity = await readLink(env, new URL(request.url).searchParams.get('k'));
      if (!identity) return json({ error: 'That link has expired. Run /interests again.' }, 404, cors);
      const member = findMember(await readInterests(env), identity) || null;
      return json({ identity, member }, 200, cors);
    }

    if (path === '/interests' && request.method === 'POST') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'Invalid JSON' }, 400, cors);

      const identity = await readLink(env, body.k);
      const record = normalizeInterests(identity ? { ...body, player: identity.name } : body);
      if (!record) return json({ error: 'Missing player' }, 400, cors);

      const members = identity
        ? await saveLinkedInterest(env, record, identity)
        : await saveInterest(env, record);
      return json({ ok: true, members }, 200, cors);
    }

    if (path === '/cycle' && request.method === 'GET') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const raw = await env.CLUB.get('cycle:current');
      return json({ cycle: raw ? JSON.parse(raw) : null }, 200, cors);
    }

    // The draw happens here, not in the browser, and only once per cycle.
    if (path === '/draw' && request.method === 'POST') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);

      const existing = await env.CLUB.get('cycle:current');
      if (existing) {
        return json(
          { error: 'This cycle has already been drawn.', cycle: JSON.parse(existing) },
          409,
          cors
        );
      }

      const body = await request.json().catch(() => ({}));
      const catalog = await getCatalogCached(ctx);
      if (!catalog) return json({ error: 'Catalog unavailable' }, 502, cors);

      const members = await readInterests(env);
      const rules = buildRules(members);
      const pool = buildPool(JSON.parse(catalog.body).games, rules);
      if (!pool.length) {
        return json({ error: 'No games everyone can play. Loosen the vetoes.' }, 400, cors);
      }

      const result = drawGame(pool, rules);
      const cycle = {
        game: slimGame(result.game),
        poolSize: result.poolSize,
        reasons: result.reasons,
        drawnBy: clip(body.drawnBy, 60) || 'someone',
        drawnAt: new Date().toISOString(),
      };

      await env.CLUB.put('cycle:current', JSON.stringify(cycle));

      if (env.DISCORD_WEBHOOK_URL) {
        await postToDiscord(env, {
          content: `**The wheel has spoken.** ${cycle.drawnBy} drew this cycle\u2019s game \u2014 one shot, no rerolls:`,
          embeds: [
            {
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
            },
          ],
        });
      }

      return json({ ok: true, cycle }, 200, cors);
    }

    // Rerolling is possible but never quiet: it archives the pick and announces itself.
    if (path === '/cycle/new' && request.method === 'POST') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const body = await request.json().catch(() => ({}));
      const by = clip(body.by, 60) || 'someone';

      const raw = await env.CLUB.get('cycle:current');
      if (raw) await env.CLUB.put(`cycle:past:${Date.now()}`, raw);
      await env.CLUB.delete('cycle:current');

      if (env.DISCORD_WEBHOOK_URL) {
        const previous = raw ? JSON.parse(raw).game.title : null;
        await postToDiscord(env, {
          content: previous
            ? `**${by}** closed the cycle on *${previous}* and opened a new one. The next draw is live.`
            : `**${by}** opened a new cycle. The next draw is live.`,
        });
      }

      return json({ ok: true }, 200, cors);
    }

    if (path === '/checkin' && request.method === 'POST') {
      if (!env.DISCORD_WEBHOOK_URL) return json({ error: 'Webhook not configured' }, 500, cors);
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'Invalid JSON' }, 400, cors);

      const player = clip(body.player, 60);
      const stateLabel = clip(body.stateLabel, 40);
      if (!player || !stateLabel) return json({ error: 'Missing player or state' }, 400, cors);

      const fields = (Array.isArray(body.fields) ? body.fields : []).slice(0, 12).map((f) => ({
        name: clip(f.name, 60) || '\u200b',
        value: clip(f.value, 900) || '\u200b',
        inline: !!f.inline,
      }));

      // Record it too, so /status sees web and bot check-ins alike.
      const currentRaw = await env.CLUB?.get('cycle:current');
      if (currentRaw && body.stateId) {
        const current = JSON.parse(currentRaw);
        await saveCheckin(env, current.drawnAt, {
          player,
          userId: null,
          state: clip(body.stateId, 40),
          hours: typeof body.hours === 'number' ? body.hours : null,
          far: clip(body.far, 120),
          take: clip(body.take, 400),
          spoilers: clip(body.spoilers, 20) || 'mine',
          at: new Date().toISOString(),
        });
      }

      const ok = await postToDiscord(env, {
        embeds: [
          {
            title: `${player} \u2014 ${stateLabel}`,
            description: clip(body.headline, 300) || undefined,
            color: Number.isInteger(body.color) ? body.color : 0x5865f2,
            fields,
            footer: { text: clip(body.game, 100) || 'Checkpoint' },
            timestamp: new Date().toISOString(),
          },
        ],
      });

      return ok ? json({ ok: true }, 200, cors) : json({ error: 'Discord rejected the post' }, 502, cors);
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};
