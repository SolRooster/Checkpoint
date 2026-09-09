import { esc, on } from '../dom.js';
import { GENRES } from '../interests.js';
import { buildRules, buildPool, drawGame, poolStats } from '../draw.js';
import { lockInDraw } from '../api.js';

const labelOf = (cat) => GENRES.find((g) => g.cat === cat)?.label || cat;
const TIER_LABEL = { console: 'Console', pc: 'PC', eaPlay: 'EA Play' };

export function drawView(state, rerender) {
  if (state.catalogError) {
    return {
      html: `<section class="lead"><h2 class="view-title">Catalog unavailable</h2>
        <p class="view-sub">${esc(state.catalogError)}</p>
        <button id="retry" class="submit">Try again</button></section>`,
      wire: (root) =>
        root.querySelector('#retry')?.addEventListener('click', () => {
          state.catalogError = null;
          state.catalog = null;
          rerender();
        }),
    };
  }

  if (!state.catalog) {
    return {
      html: `<section class="lead loading">
        <h2 class="view-title">Pulling the Game Pass catalog\u2026</h2>
        <p class="view-sub">Console, PC and EA Play. First load takes a few seconds.</p>
        <div class="spinner"></div>
      </section>`,
      wire: () => {},
    };
  }

  const games = state.catalog.games;
  const rules = buildRules(state.members);
  const pool = buildPool(games, rules);
  const stats = poolStats(games, rules);
  const vetoed = [...rules.vetoes];

  const result = state.draw;

  const html = `
    <section class="lead">
      <h2 class="view-title">The Draw</h2>
      <p class="view-sub">
        Random, but steered. Vetoes are absolute; everything else just tilts the odds.
      </p>
    </section>

    <section class="rules">
      <div class="rule-stat">
        <span class="rule-num">${pool.length}</span>
        <span class="rule-cap">games eligible</span>
      </div>
      <div class="rule-detail">
        <div>${
          rules.memberCount
            ? `<b>${rules.memberCount}</b> ${rules.memberCount === 1 ? 'person has' : 'people have'} weighed in`
            : 'No one has weighed in yet'
        }</div>
        ${
          stats.tightest && rules.memberCount > 1
            ? `<div>Narrowest access: <b>${esc(stats.tightest.player)}</b> on ${esc(stats.tightest.planLabel)} (${stats.tightest.reach} games)</div>`
            : ''
        }
        ${
          stats.blockedByAccess
            ? `<div class="muted-line">${stats.blockedByAccess} games skipped — not everyone can play them</div>`
            : rules.memberCount
              ? '<div class="rule-ok">Everyone can reach the whole catalog</div>'
              : ''
        }
        ${
          vetoed.length
            ? `<div class="rule-veto">Vetoed: ${vetoed.map((v) => esc(labelOf(v))).join(', ')} <span>(${stats.blockedByVeto} more removed)</span></div>`
            : '<div class="rule-ok">No vetoes on record</div>'
        }
        ${rules.recentOnly ? '<div>Everyone wants recent releases only</div>' : ''}
      </div>
    </section>

    ${
      rules.memberCount > 1
        ? `<div class="access-strip">
            ${stats.perMember
              .map(
                (m) => `<span class="access-chip"><b>${esc(m.player)}</b> ${esc(m.planLabel)} · ${m.reach} games</span>`
              )
              .join('')}
          </div>`
        : ''
    }

    ${
      !rules.memberCount
        ? `<p class="warn">Nobody has filled in interests yet, so this is a pure coin flip across all ${games.length} games. Add interests to steer it.</p>`
        : ''
    }

    ${
      result
        ? `
    <section class="result" id="result">
      <div class="result-label">This cycle&rsquo;s pick</div>
      <div class="result-card">
        ${result.game.img ? `<img class="result-art" src="${esc(result.game.img)}" alt="${esc(result.game.title)}" />` : ''}
        <div class="result-body">
          <h3 class="result-title">${esc(result.game.title)}</h3>
          ${result.game.dev ? `<div class="result-dev">${esc(result.game.dev)}</div>` : ''}
          <div class="result-tags">
            ${result.game.cats.map((c) => `<span class="tag">${esc(labelOf(c))}</span>`).join('')}
            ${result.game.play?.coop ? '<span class="tag coop">Co-op</span>' : ''}
            ${result.game.tiers.map((t) => `<span class="tag tier">${esc(TIER_LABEL[t] || t)}</span>`).join('')}
          </div>
          ${result.game.blurb ? `<p class="result-blurb">${esc(result.game.blurb)}</p>` : ''}
          <ul class="result-why">
            ${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}
          </ul>
          <div class="result-pool">Drawn from ${result.poolSize} eligible games.</div>
        </div>
      </div>
      <div class="result-actions">
        <button id="lock" class="submit">Lock it in &amp; post to Discord</button>
        <button id="redraw" class="submit ghost">Draw again</button>
      </div>
      <p id="d-status" class="status"></p>
    </section>`
        : `
    <section class="block submit-block">
      <button id="spin" class="submit big" ${!pool.length ? 'disabled' : ''}>
        ${pool.length ? 'Draw this cycle\u2019s game' : 'Nothing everyone can play \u2014 loosen the vetoes'}
      </button>
    </section>`
    }
  `;

  const wire = (root) => {
    root.querySelector('#spin')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      // Rattle through candidates so the draw feels like a draw.
      for (let i = 0; i < 18; i++) {
        const peek = pool[Math.floor(Math.random() * pool.length)];
        btn.textContent = peek.title.slice(0, 34);
        await new Promise((r) => setTimeout(r, 55 + i * 6));
      }
      state.draw = drawGame(pool, rules);
      rerender();
    });

    root.querySelector('#redraw')?.addEventListener('click', () => {
      state.draw = null;
      rerender();
    });

    root.querySelector('#lock')?.addEventListener('click', async (e) => {
      const status = root.querySelector('#d-status');
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Posting\u2026';
      try {
        state.cycle = await lockInDraw({
          game: state.draw.game,
          poolSize: state.draw.poolSize,
          reasons: state.draw.reasons,
          drawnBy: state.myInterests.player || 'someone',
        });
        state.draw = null;
        state.tab = 'checkin';
        rerender();
      } catch (err) {
        status.textContent = err.message;
        status.className = 'status err';
        e.currentTarget.disabled = false;
        e.currentTarget.textContent = 'Lock it in & post to Discord';
      }
    });

    on(root, '.result-art', 'error', (e) => e.currentTarget.remove());
  };

  return { html, wire };
}
