// One-off: drop a stale duplicate member and rewrite the aggregate deterministically.
const BASE = 'https://checkpoint-webhook.roster-support.workers.dev';
const DROP = (process.argv[2] || '').toLowerCase();

const { members } = await (await fetch(`${BASE}/interests`)).json();
const kept = members.filter((m) => m.player.toLowerCase() !== DROP);

console.log(`before (${members.length}): ${members.map((m) => m.player).join(', ')}`);
console.log(`after  (${kept.length}): ${kept.map((m) => m.player).join(', ')}`);

const { writeFileSync } = await import('node:fs');
writeFileSync(new URL('./aggregate.json', import.meta.url), JSON.stringify(kept));
console.log('wrote tools/aggregate.json');
