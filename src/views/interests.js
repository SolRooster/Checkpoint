import { esc, on } from '../dom.js';
import { GENRES, APPETITE, PLANS, ERAS, TOGETHER, planLabel } from '../interests.js';
import { saveInterests } from '../api.js';

export function interestsView(state, rerender) {
  const mine = state.myInterests;

  const html = `
    <section class="lead">
      <h2 class="view-title">What are you actually into?</h2>
      <p class="view-sub">
        This steers the draw. It never picks for you &mdash; a <b>hard pass</b> removes a genre
        from the pool entirely, and <b>into it</b> just improves those odds.
      </p>
    </section>

    <section class="block">
      <label class="field-label" for="i-player">Your name</label>
      <input id="i-player" class="text-input" type="text" maxlength="60" autocomplete="off"
        placeholder="Your name or Discord handle" value="${esc(mine.player)}" />
    </section>

    <section class="block">
      <div class="field-label">Which Game Pass do you have?</div>
      <p class="hint">The draw only offers games <b>everyone</b> can already play. Nobody gets asked to buy anything.</p>
      <div class="chips">
        ${PLANS.map(
          (p) => `
          <button type="button" class="chip wide${mine.plan === p.id ? ' on' : ''}" data-plan="${p.id}">
            <b>${esc(p.label)}</b><span>${esc(p.hint)}</span>
          </button>`
        ).join('')}
      </div>
      <button type="button" class="chip wide ea${mine.eaPlay ? ' on' : ''}" data-ea="1">
        <b>${mine.eaPlay ? '\u2713 ' : ''}I also have EA Play</b><span>Adds the EA library</span>
      </button>
    </section>

    <section class="block">
      <div class="field-label">Genre appetite</div>
      <p class="hint">Leave anything you don't care about on <b>Fine</b>. Only flag a hard pass if you'd genuinely sit the cycle out.</p>
      <div class="genre-list">
        ${GENRES.map((g) => {
          const value = mine.appetite[g.cat] || 'ok';
          return `
          <div class="genre-row">
            <span class="genre-name">${esc(g.label)}</span>
            <div class="genre-opts">
              ${APPETITE.map(
                (a) => `
                <button type="button" class="opt opt-${a.id}${value === a.id ? ' on' : ''}"
                  data-cat="${esc(g.cat)}" data-appetite="${a.id}" title="${esc(a.hint)}">${esc(a.label)}</button>`
              ).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="block">
      <div class="field-label">Playing together?</div>
      <p class="hint">Co-op support comes straight from the store data, so this genuinely shifts the odds.</p>
      <div class="chips">
        ${TOGETHER.map(
          (t) => `
          <button type="button" class="chip wide${mine.together === t.id ? ' on' : ''}" data-together="${t.id}">
            <b>${esc(t.label)}</b><span>${esc(t.hint)}</span>
          </button>`
        ).join('')}
      </div>
    </section>

    <section class="block">
      <div class="field-label">How old can it be?</div>
      <p class="hint">Recent-only applies only if <i>everyone</i> picks it.</p>
      <div class="chips">
        ${ERAS.map(
          (e) => `
          <button type="button" class="chip wide${mine.era === e.id ? ' on' : ''}" data-era="${e.id}">
            <b>${esc(e.label)}</b><span>${esc(e.hint)}</span>
          </button>`
        ).join('')}
      </div>
    </section>

    <section class="block">
      <label class="field-label" for="i-note">Anything else? <span class="opt-note">(optional)</span></label>
      <input id="i-note" class="text-input" type="text" maxlength="200"
        placeholder="e.g. nothing horror, co-op would be great" value="${esc(mine.note)}" />
    </section>

    <section class="block submit-block">
      <button id="save-interests" class="submit">Save my interests</button>
      <p id="i-status" class="status"></p>
    </section>

    ${
      state.members.length
        ? `
    <section class="block">
      <div class="field-label">Who's weighed in (${state.members.length})</div>
      <div class="member-list">
        ${state.members
          .map((m) => {
            const loves = Object.entries(m.appetite || {})
              .filter(([, v]) => v === 'in')
              .map(([c]) => GENRES.find((g) => g.cat === c)?.label || c);
            const nos = Object.entries(m.appetite || {})
              .filter(([, v]) => v === 'no')
              .map(([c]) => GENRES.find((g) => g.cat === c)?.label || c);
            return `
            <div class="member">
              <b>${esc(m.player)}</b>
              <span class="member-plan">${esc(planLabel(m.plan))}${m.eaPlay ? ' + EA Play' : ''}</span>
              ${loves.length ? `<span class="tag-in">into: ${esc(loves.join(', '))}</span>` : ''}
              ${nos.length ? `<span class="tag-no">passes: ${esc(nos.join(', '))}</span>` : ''}
              ${m.note ? `<span class="member-note">&ldquo;${esc(m.note)}&rdquo;</span>` : ''}
            </div>`;
          })
          .join('')}
      </div>
    </section>`
        : ''
    }
  `;

  const wire = (root) => {
    root.querySelector('#i-player')?.addEventListener('input', (e) => {
      mine.player = e.target.value;
    });
    root.querySelector('#i-note')?.addEventListener('input', (e) => {
      mine.note = e.target.value;
    });

    on(root, '[data-plan]', 'click', (e) => {
      mine.plan = e.currentTarget.dataset.plan;
      rerender();
    });

    on(root, '[data-ea]', 'click', () => {
      mine.eaPlay = !mine.eaPlay;
      rerender();
    });

    on(root, '[data-appetite]', 'click', (e) => {
      const { cat, appetite } = e.currentTarget.dataset;
      if (appetite === 'ok') delete mine.appetite[cat];
      else mine.appetite[cat] = appetite;
      rerender();
    });

    on(root, '[data-era]', 'click', (e) => {
      mine.era = e.currentTarget.dataset.era;
      rerender();
    });

    on(root, '[data-together]', 'click', (e) => {
      mine.together = e.currentTarget.dataset.together;
      rerender();
    });

    root.querySelector('#save-interests')?.addEventListener('click', async (e) => {
      const status = root.querySelector('#i-status');
      if (!mine.player.trim()) {
        status.textContent = 'Add your name first.';
        status.className = 'status err';
        return;
      }
      if (!mine.plan) {
        status.textContent = 'Pick which Game Pass you have.';
        status.className = 'status err';
        return;
      }

      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Saving\u2026';
      try {
        state.members = await saveInterests(mine);
        localStorage.setItem('checkpoint_player', mine.player);
        state.saved = true;
        rerender();
      } catch (err) {
        status.textContent = err.message;
        status.className = 'status err';
        e.currentTarget.disabled = false;
        e.currentTarget.textContent = 'Save my interests';
      }
    });
  };

  return { html, wire };
}
