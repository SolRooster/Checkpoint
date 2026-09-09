import { esc, on } from '../dom.js';
import { CLUB } from '../club.js';
import { STATES, SPOILERS, HOUR_CHIPS, getState } from '../states.js';
import { postCheckIn } from '../api.js';

export function checkinView(state, rerender) {
  const pick = state.cycle?.game;
  const form = state.checkin;

  if (!pick) {
    return {
      html: `<section class="lead">
        <h2 class="view-title">No game drawn yet</h2>
        <p class="view-sub">Once the group locks in a pick, this is where you say where you're at.</p>
        <button id="to-draw" class="submit">Go to the Draw</button>
      </section>`,
      wire: (root) =>
        root.querySelector('#to-draw')?.addEventListener('click', () => {
          state.tab = 'draw';
          rerender();
        }),
    };
  }

  if (state.checkedIn) {
    const done = getState(form.state);
    return {
      html: `<section class="done" style="--accent:${done.accent}">
        <div class="done-mark">Checked in</div>
        <h2 class="done-title">${esc(done.label)}</h2>
        <p class="done-copy">Posted to Discord. See you ${esc(CLUB.cycle.discussion)} in ${esc(CLUB.cycle.where)}.</p>
        <p class="done-copy muted">Play more, bounce, change your mind &mdash; just check in again.</p>
        <button id="again" class="submit ghost">Update my check-in</button>
      </section>`,
      wire: (root) =>
        root.querySelector('#again')?.addEventListener('click', () => {
          state.checkedIn = false;
          Object.assign(form, { state: null, hours: '', marker: '', take: '' });
          rerender();
        }),
    };
  }

  const active = form.state ? getState(form.state) : null;
  const asks = active?.asks || [];

  const html = `
    <section class="pick">
      <div class="pick-label">This cycle &middot; drawn from ${state.cycle.poolSize} eligible games</div>
      <div class="pick-head">
        ${pick.img ? `<img class="pick-art" src="${esc(pick.img)}" alt="" />` : ''}
        <div>
          <h1 class="pick-title">${esc(pick.title)}</h1>
          ${pick.dev ? `<div class="result-dev">${esc(pick.dev)}</div>` : ''}
          <div class="result-tags">
            ${(pick.cats || []).map((c) => `<span class="tag">${esc(c)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="pick-when">
        Talking about it <b>${esc(CLUB.cycle.discussion)}</b> in ${esc(CLUB.cycle.where)}
      </div>
    </section>

    <p class="creed">
      No one has to finish. The moment you feel like you've got your take, you're done &mdash;
      log it, show up, talk about it.
    </p>

    <section class="block">
      <label class="field-label" for="player">Who are you?</label>
      <input id="player" class="text-input" type="text" maxlength="60" autocomplete="off"
        placeholder="Your name or Discord handle" value="${esc(form.player)}" />
    </section>

    <section class="block">
      <div class="field-label">Where are you at?</div>
      <div class="state-grid">
        ${STATES.map(
          (s) => `
          <button type="button" class="state-card${form.state === s.id ? ' selected' : ''}${s.featured ? ' featured' : ''}"
            data-state="${s.id}" style="--accent:${s.accent}">
            <span class="state-label">${esc(s.label)}</span>
            <span class="state-tag">${esc(s.tag)}</span>
            <span class="state-blurb">${esc(s.blurb)}</span>
          </button>`
        ).join('')}
      </div>
    </section>

    ${
      active
        ? `
    <section class="block context" style="--accent:${active.accent}">
      <div class="field-label">Add some context <span class="opt-note">(all optional)</span></div>

      ${
        asks.includes('hours')
          ? `
      <div class="sub">
        <label class="sub-label" for="hours">Hours played</label>
        <p class="hint">Helps everyone read your take &mdash; a 2-hour opinion and a 40-hour opinion are both worth hearing.</p>
        <div class="hours-row">
          <input id="hours" class="text-input short" type="number" min="0" max="999" step="0.5"
            placeholder="0" value="${esc(form.hours)}" />
          <div class="chips">
            ${HOUR_CHIPS.map(
              (h) => `<button type="button" class="chip${String(form.hours) === String(h) ? ' on' : ''}" data-hours="${h}">${h}h</button>`
            ).join('')}
          </div>
        </div>
      </div>`
          : ''
      }

      ${
        asks.includes('marker')
          ? `
      <div class="sub">
        <label class="sub-label" for="marker">How far did you get?</label>
        <p class="hint">Chapter, area, rank, boss &mdash; whatever marks your spot.</p>
        <input id="marker" class="text-input" type="text" maxlength="120"
          placeholder="e.g. end of Act 1, hit rank 12, first big boss" value="${esc(form.marker)}" />
      </div>`
          : ''
      }

      ${
        asks.includes('take')
          ? `
      <div class="sub">
        <label class="sub-label" for="take">Your take so far</label>
        <p class="hint">One line is plenty. Save the essay for the call.</p>
        <textarea id="take" class="text-input area" maxlength="400" rows="3"
          placeholder="What stuck with you, or what pushed you off?">${esc(form.take)}</textarea>
      </div>`
          : ''
      }

      <div class="sub">
        <label class="sub-label">Spoiler comfort</label>
        <p class="hint">Everyone stops at a different place. This tells the group how to talk to you.</p>
        <div class="chips">
          ${SPOILERS.map(
            (s) => `
            <button type="button" class="chip wide${form.spoilers === s.id ? ' on' : ''}" data-spoiler="${s.id}">
              <b>${esc(s.label)}</b><span>${esc(s.hint)}</span>
            </button>`
          ).join('')}
        </div>
      </div>
    </section>`
        : ''
    }

    <section class="block submit-block">
      <button id="submit" class="submit" ${!form.state ? 'disabled' : ''}>
        ${form.state ? 'Post my check-in' : 'Pick a state first'}
      </button>
      <p id="status" class="status"></p>
      <p class="fine">You can check in again any time your status changes.</p>
    </section>
  `;

  const wire = (root) => {
    root.querySelector('#player')?.addEventListener('input', (e) => {
      form.player = e.target.value;
      localStorage.setItem('checkpoint_player', form.player);
    });

    on(root, '[data-state]', 'click', (e) => {
      const id = e.currentTarget.dataset.state;
      form.state = id === form.state ? null : id;
      rerender();
    });

    on(root, '[data-hours]', 'click', (e) => {
      const h = e.currentTarget.dataset.hours;
      form.hours = String(form.hours) === h ? '' : h;
      rerender();
    });

    on(root, '[data-spoiler]', 'click', (e) => {
      form.spoilers = e.currentTarget.dataset.spoiler;
      rerender();
    });

    ['hours', 'marker', 'take'].forEach((id) => {
      root.querySelector(`#${id}`)?.addEventListener('input', (e) => {
        form[id] = e.target.value;
      });
    });

    root.querySelector('#submit')?.addEventListener('click', async (e) => {
      const status = root.querySelector('#status');
      if (!form.player.trim()) {
        status.textContent = 'Add your name first.';
        status.className = 'status err';
        return;
      }

      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Posting\u2026';

      try {
        await postCheckIn(buildPayload(form, pick));
        state.checkedIn = true;
        rerender();
      } catch (err) {
        status.textContent = err.message;
        status.className = 'status err';
        btn.disabled = false;
        btn.textContent = 'Post my check-in';
      }
    });

    on(root, '.pick-art', 'error', (e) => e.currentTarget.remove());
  };

  return { html, wire };
}

function buildPayload(form, pick) {
  const state = getState(form.state);
  const fields = [];

  if (state.asks.includes('hours') && form.hours !== '') {
    fields.push({ name: 'Time played', value: `${form.hours} hrs`, inline: true });
  }
  if (state.asks.includes('marker') && form.marker.trim()) {
    fields.push({ name: 'Got as far as', value: form.marker.trim(), inline: true });
  }
  fields.push({
    name: 'Spoilers',
    value: SPOILERS.find((s) => s.id === form.spoilers).label,
    inline: true,
  });
  if (state.asks.includes('take') && form.take.trim()) {
    fields.push({ name: 'Their take', value: form.take.trim(), inline: false });
  }

  return {
    player: form.player.trim(),
    stateLabel: `${state.label} \u00b7 ${state.tag}`,
    headline: state.blurb,
    color: parseInt(state.accent.slice(1), 16),
    game: pick.title,
    fields,
  };
}
