// What does the real pool look like, and what changes if someone's platform is corrected?
import { buildRules, buildPool, poolStats } from '../shared/draw.js';

const BASE = 'https://checkpoint-webhook.roster-support.workers.dev';

const catalog = await (await fetch(`${BASE}/catalog`)).json();
const { members } = await (await fetch(`${BASE}/interests`)).json();

function report(label, roster) {
  const rules = buildRules(roster);
  const pool = buildPool(catalog.games, rules);
  const stats = poolStats(catalog.games, rules);
  console.log(`\n=== ${label}`);
  console.log(`  eligible          : ${pool.length} of ${catalog.count}`);
  console.log(`  blocked by access : ${stats.blockedByAccess}`);
  console.log(`  blocked by vetoes : ${stats.blockedByVeto}`);
  console.log(
    `  tightest          : ${stats.tightest ? `${stats.tightest.player} (${stats.tightest.planLabel}) reaches ${stats.tightest.reach}` : 'n/a'}`
  );
  console.log(`  off Game Pass     : ${rules.offPlatform.map((m) => m.player).join(', ') || 'nobody'}`);
  console.log(`  co-op in pool     : ${pool.filter((g) => g.play?.coop).length}`);
  return pool.length;
}

const asIs = report('AS IT STANDS (Devon marked Xbox console)', members);
const corrected = report(
  'CORRECTED (Devon marked PlayStation / no Game Pass)',
  members.map((m) => (m.player === 'Nomad Von' ? { ...m, plan: 'other' } : m))
);

console.log(`\nnet change: ${corrected - asIs > 0 ? '+' : ''}${corrected - asIs} games`);
console.log('vetoed genres:', [...buildRules(members).vetoes].join(', '));
