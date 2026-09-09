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
