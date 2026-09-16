import { esc, on } from '../dom.js';
import { genreLabel } from '../interests.js';
import { buildRules, buildPool, poolStats } from '../draw.js';
import { drawCycle, newCycle } from '../api.js';

const TIER_LABEL = { console: 'Console', pc: 'PC', eaPlay: 'EA Play' };

const gameCard = (game, reasons, poolSize) => `
  <div class="result-card">
    ${game.img ? `<img class="result-art" src="${esc(game.img)}" alt="${esc(game.title)}" />` : ''}
    <div class="result-body">
      <h3 class="result-title">${esc(game.title)}</h3>
      ${game.dev ? `<div class="result-dev">${esc(game.dev)}</div>` : ''}
      <div class="result-tags">
        ${(game.cats || []).map((c) => `<span class="tag">${esc(genreLabel(c))}</span>`).join('')}
        ${game.play?.coop ? '<span class="tag coop">Co-op</span>' : ''}
        ${(game.tiers || []).map((t) => `<span class="tag tier">${esc(TIER_LABEL[t] || t)}</span>`).join('')}
      </div>
      ${game.blurb ? `<p class="result-blurb">${esc(game.blurb)}</p>` : ''}
      <ul class="result-why">${(reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${poolSize ? `<div class="result-pool">Drawn from ${poolSize} eligible games.</div>` : ''}
    </div>
  </div>`;

export function drawView(state, rerender) {
  // Already drawn: the cycle is settled, and the only way out is a new cycle.
  if (state.cycle) {
    const { game, reasons, poolSize, drawnBy } = state.cycle;
    return {
      html: `
        <section class="lead">
          <h2 class="view-title">Already drawn</h2>
          <p class="view-sub">
            One shot per cycle. ${esc(drawnBy || 'Someone')} rolled it and it stands
            &mdash; if it's not for you, play a bit and mark <b>Called It</b>.
          </p>
        </section>
        <section class="result">
          <div class="result-label">This cycle&rsquo;s pick</div>
          ${gameCard(game, reasons, poolSize)}
          <div class="result-actions">
            <button id="to-checkin" class="submit">Check in</button>
            <button id="new-cycle" class="submit ghost">Start a new cycle</button>
          </div>
          <p class="fine">Starting a new cycle archives this pick and announces it in #league.</p>
          <p id="d-status" class="status"></p>
        </section>`,
      wire: (root) => {
        root.querySelector('#to-checkin')?.addEventListener('click', () => {
          state.tab = 'checkin';
          rerender();
        });

        root.querySelector('#new-cycle')?.addEventListener('click', async (e) => {
          const status = root.querySelector('#d-status');
          if (!state.confirmNew) {
            state.confirmNew = true;
            e.currentTarget.textContent = 'Really? This is public \u2014 click again';
            return;
          }
          e.currentTarget.disabled = true;
          try {
            await newCycle(state.myInterests.player || 'someone');
            state.cycle = null;
            state.confirmNew = false;
            rerender();
          } catch (err) {
            status.textContent = err.message;
            status.className = 'status err';
            e.currentTarget.disabled = false;
          }
        });

        on(root, '.result-art', 'error', (ev) => ev.currentTarget.remove());
      },
    };
  }

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

  const html = `
    <section class="lead">
      <h2 class="view-title">The Draw</h2>
      <p class="view-sub">
        Random, but steered. Vetoes are absolute; everything else just tilts the odds.
        <b>You get one spin</b> &mdash; whatever lands, lands.
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
            ? `<div class="muted-line">${stats.blockedByAccess} games skipped &mdash; not everyone can play them</div>`
            : rules.memberCount
              ? '<div class="rule-ok">Everyone can reach the whole catalog</div>'
              : ''
        }
        ${
          vetoed.length
            ? `<div class="rule-veto">Vetoed: ${vetoed.map((v) => esc(genreLabel(v))).join(', ')} <span>(${stats.blockedByVeto} more removed)</span></div>`
            : '<div class="rule-ok">No vetoes on record</div>'
        }
        ${rules.recentOnly ? '<div>Everyone wants recent releases only</div>' : ''}
      </div>
    </section>

    ${
      rules.offPlatform?.length
        ? `<p class="warn offplat">
            <b>${rules.offPlatform.map((m) => esc(m.player)).join(', ')}</b>
            ${rules.offPlatform.length === 1 ? "isn't" : "aren't"} on Game Pass.
            Their genre votes still count, but the pick won't be free for them &mdash;
            they'll need to source it themselves.
          </p>`
        : ''
    }

    ${
      rules.memberCount > 1
        ? `<div class="access-strip">
            ${stats.perMember
              .map((m) => `<span class="access-chip"><b>${esc(m.player)}</b> ${esc(m.planLabel)} \u00b7 ${m.reach} games</span>`)
              .join('')}
          </div>`
        : ''
    }

    ${
      !rules.memberCount
        ? `<p class="warn">Nobody has filled in interests yet, so this is a pure coin flip across all ${games.length} games. Add interests to steer it.</p>`
        : ''
    }

    <section class="block gate">
      <div class="gate-head">Before you spin</div>
      <ul class="gate-points">
        <li><b>This is binding.</b> One draw per cycle &mdash; there are no rerolls.</li>
        <li>It posts to <b>#league</b> the moment it lands.</li>
        <li>Only the <b>${rules.memberCount}</b> ${rules.memberCount === 1 ? 'person' : 'people'} below are accounted for.
            Anyone who hasn't weighed in yet gets no say.</li>
      </ul>
      ${
        rules.memberCount
          ? `<div class="gate-roster">${stats.perMember
              .map((m) => `<span class="access-chip"><b>${esc(m.player)}</b> ${esc(m.planLabel)}</span>`)
              .join('')}</div>`
          : ''
      }
      <label class="sub-label" for="confirm-draw">Type <b>DRAW</b> to unlock the spin</label>
      <input id="confirm-draw" class="text-input" type="text" autocomplete="off"
        placeholder="DRAW" maxlength="10" />
      <button id="spin" class="submit big" disabled>
        ${pool.length ? 'Draw this cycle\u2019s game' : 'Nothing everyone can play \u2014 loosen the vetoes'}
      </button>
      <p id="d-status" class="status"></p>
    </section>
  `;

  const wire = (root) => {
    const spin = root.querySelector('#spin');

    // Typing the word is the only guard available without Discord identity.
    root.querySelector('#confirm-draw')?.addEventListener('input', (e) => {
      spin.disabled = e.target.value.trim().toUpperCase() !== 'DRAW' || !pool.length;
    });

    spin?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const status = root.querySelector('#d-status');
      btn.disabled = true;

      // Rattle through candidates so the draw feels like a draw.
      for (let i = 0; i < 18; i++) {
        btn.textContent = pool[Math.floor(Math.random() * pool.length)].title.slice(0, 34);
        await new Promise((r) => setTimeout(r, 55 + i * 6));
      }

      try {
        state.cycle = await drawCycle(state.myInterests.player || 'someone');
        rerender();
      } catch (err) {
        if (err.status === 409 && err.cycle) {
          state.cycle = err.cycle;
          rerender();
          return;
        }
        status.textContent = err.message;
        status.className = 'status err';
        btn.disabled = false;
        btn.textContent = 'Draw this cycle\u2019s game';
      }
    });
  };

  return { html, wire };
}
