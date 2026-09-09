/**
 * Checkpoint Worker — catalog gateway, interest store, draw recorder, Discord relay.
 *
 * Bindings:
 *   DISCORD_WEBHOOK_URL  Secret
 *   ALLOWED_ORIGIN       Text, comma-separated origins
 *   CLUB                 KV namespace (interests + current cycle)
 */

import { SIGLS, buildCatalog } from '../shared/catalog.js';

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

const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function handleCatalog(ctx, cors) {
  const cacheKey = new Request('https://checkpoint.internal/catalog');
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    return new Response(await hit.text(), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const catalog = await buildCatalog();
  if (!catalog.count) return json({ error: 'Catalog came back empty' }, 502, cors);

  const body = JSON.stringify(catalog);
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_TTL}` },
      })
    )
  );
  return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function readInterests(env) {
  const list = await env.CLUB.list({ prefix: 'interest:' });
  const members = [];
  for (const key of list.keys) {
    const raw = await env.CLUB.get(key.name);
    if (raw) members.push(JSON.parse(raw));
  }
  return members;
}

function normalizeInterests(body) {
  const player = clip(body.player, 60);
  if (!player) return null;

  const appetite = {};
  for (const [cat, value] of Object.entries(body.appetite || {})) {
    if (value === 'in' || value === 'no') appetite[clip(cat, 60)] = value;
  }

  return {
    player,
    plan: ['ultimate', 'pc', 'console'].includes(body.plan) ? body.plan : 'ultimate',
    eaPlay: !!body.eaPlay,
    appetite,
    era: body.era === 'recent' ? 'recent' : 'any',
    together: body.together === 'coop' ? 'coop' : 'any',
    note: clip(body.note, 200),
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
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);

    if (path === '/catalog' && request.method === 'GET') return handleCatalog(ctx, cors);

    if (path === '/interests' && request.method === 'GET') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      return json({ members: await readInterests(env) }, 200, cors);
    }

    if (path === '/interests' && request.method === 'POST') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const body = await request.json().catch(() => null);
      const record = body && normalizeInterests(body);
      if (!record) return json({ error: 'Missing player' }, 400, cors);
      await env.CLUB.put(`interest:${record.player.toLowerCase()}`, JSON.stringify(record));
      return json({ ok: true, members: await readInterests(env) }, 200, cors);
    }

    if (path === '/cycle' && request.method === 'GET') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const raw = await env.CLUB.get('cycle:current');
      return json({ cycle: raw ? JSON.parse(raw) : null }, 200, cors);
    }

    if (path === '/draw' && request.method === 'POST') {
      if (!env.CLUB) return json({ error: 'KV not bound' }, 501, cors);
      const body = await request.json().catch(() => ({}));
      const game = body.game;
      if (!game?.title) return json({ error: 'No game in draw' }, 400, cors);

      const cycle = {
        game: {
          id: clip(game.id, 40),
          title: clip(game.title, 160),
          dev: clip(game.dev, 120),
          img: clip(game.img, 400),
          cats: (game.cats || []).slice(0, 8).map((c) => clip(c, 60)),
          play: {
            coop: !!game.play?.coop,
            versus: !!game.play?.versus,
            solo: !!game.play?.solo,
          },
          tiers: (game.tiers || []).filter((t) => t in SIGLS),
        },
        poolSize: Number(body.poolSize) || 0,
        reasons: (body.reasons || []).slice(0, 5).map((r) => clip(r, 160)),
        drawnBy: clip(body.drawnBy, 60),
        drawnAt: new Date().toISOString(),
      };
      await env.CLUB.put('cycle:current', JSON.stringify(cycle));

      if (env.DISCORD_WEBHOOK_URL) {
        await postToDiscord(env, {
          content: '**The wheel has spoken.** This cycle\u2019s pick:',
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
