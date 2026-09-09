// Dev runs against the Vite middleware + localStorage; production against the Worker.
const WORKER_URL = 'https://checkpoint-webhook.roster-support.workers.dev';
const DEV = import.meta.env.DEV;

const LOCAL_INTERESTS = 'checkpoint_interests_local';
const LOCAL_CYCLE = 'checkpoint_cycle_local';
const CATALOG_CACHE = 'checkpoint_catalog';
const CATALOG_TTL = 1000 * 60 * 60 * 12;

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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
  return (await post('/interests', record)).members || [];
}

export async function getCycle() {
  if (DEV) return readLocal(LOCAL_CYCLE, null);
  const res = await fetch(`${WORKER_URL}/cycle`);
  if (!res.ok) return null;
  return (await res.json()).cycle;
}

export async function lockInDraw(payload) {
  if (DEV) {
    const cycle = { ...payload, drawnAt: new Date().toISOString() };
    localStorage.setItem(LOCAL_CYCLE, JSON.stringify(cycle));
    return cycle;
  }
  return (await post('/draw', payload)).cycle;
}

export async function postCheckIn(payload) {
  if (DEV) {
    console.info('[checkpoint dev] check-in would post to Discord:', payload);
    return true;
  }
  await post('/checkin', payload);
  return true;
}

export const isDev = DEV;
