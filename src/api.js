// Dev runs against the Vite middleware + localStorage; production against the Worker.
import { buildRules, buildPool, drawGame, slimGame } from '../shared/draw.js';

const WORKER_URL = 'https://checkpoint-webhook.roster-support.workers.dev';
const DEV = import.meta.env.DEV;

const LOCAL_INTERESTS = 'checkpoint_interests_local';
const LOCAL_CYCLE = 'checkpoint_cycle_local';
const CATALOG_CACHE = 'checkpoint_catalog';
const LINK_KEY = 'checkpoint_link';
const CATALOG_TTL = 1000 * 60 * 60 * 12;

export const getLinkToken = () => localStorage.getItem(LINK_KEY) || '';
export const setLinkToken = (t) => localStorage.setItem(LINK_KEY, t);
export const clearLinkToken = () => localStorage.removeItem(LINK_KEY);

// Resolves the personal link from /interests into a Discord identity.
export async function getMe(token) {
  if (DEV || !token) return null;
  const res = await fetch(`${WORKER_URL}/me?k=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  return res.json();
}

const readLocal = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

async function post(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.cycle = data.cycle;
    throw err;
  }
  return data;
}

export async function getCatalog() {
  const cached = readLocal(CATALOG_CACHE, null);
  if (cached && Date.now() - cached.at < CATALOG_TTL) return cached.data;

  const res = await fetch(DEV ? '/api/catalog' : `${WORKER_URL}/catalog`);
  if (!res.ok) throw new Error(`Could not load the Game Pass catalog (${res.status})`);
  const data = await res.json();

  try {
    localStorage.setItem(CATALOG_CACHE, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Catalog is ~1MB; if storage is full just re-fetch next time.
  }
  return data;
}

export async function getInterests() {
  if (DEV) return readLocal(LOCAL_INTERESTS, []);
  const res = await fetch(`${WORKER_URL}/interests`);
  if (!res.ok) throw new Error('Could not load the group\u2019s interests');
  return (await res.json()).members || [];
}

export async function saveInterests(record) {
  if (DEV) {
    const all = readLocal(LOCAL_INTERESTS, []).filter(
      (m) => m.player.toLowerCase() !== record.player.toLowerCase()
    );
    all.push({ ...record, updated: new Date().toISOString() });
    localStorage.setItem(LOCAL_INTERESTS, JSON.stringify(all));
    return all;
  }
  const token = getLinkToken();
  return (await post('/interests', token ? { ...record, k: token } : record)).members || [];
}

export async function getCycle() {
  if (DEV) return readLocal(LOCAL_CYCLE, null);
  const res = await fetch(`${WORKER_URL}/cycle`);
  if (!res.ok) return null;
  return (await res.json()).cycle;
}

// One shot per cycle: the Worker owns the roll so the browser can't reroll.
export async function drawCycle(drawnBy) {
  if (DEV) {
    if (readLocal(LOCAL_CYCLE, null)) {
      const err = new Error('This cycle has already been drawn.');
      err.status = 409;
      err.cycle = readLocal(LOCAL_CYCLE, null);
      throw err;
    }
    const catalog = await getCatalog();
    const rules = buildRules(await getInterests());
    const pool = buildPool(catalog.games, rules);
    if (!pool.length) throw new Error('No games everyone can play. Loosen the vetoes.');

    const result = drawGame(pool, rules);
    const cycle = {
      game: slimGame(result.game),
      poolSize: result.poolSize,
      reasons: result.reasons,
      drawnBy: drawnBy || 'someone',
      drawnAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_CYCLE, JSON.stringify(cycle));
    return cycle;
  }
  return (await post('/draw', { drawnBy })).cycle;
}

export async function newCycle(by) {
  if (DEV) {
    localStorage.removeItem(LOCAL_CYCLE);
    return true;
  }
  await post('/cycle/new', { by });
  return true;
}

export async function postCheckIn(payload) {
  if (DEV) {
    console.info('[checkpoint dev] check-in would post to Discord:', payload);
    return true;
  }
  const token = getLinkToken();
  await post('/checkin', token ? { ...payload, k: token } : payload);
  return true;
}

export const isDev = DEV;
