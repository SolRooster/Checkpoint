import './style.css';
import { CLUB } from './club.js';
import { blankInterests } from './interests.js';
import { getCatalog, getInterests, getCycle, isDev } from './api.js';
import { interestsView } from './views/interests.js';
import { drawView } from './views/draw.js';
import { checkinView } from './views/checkin.js';
import { esc, on } from './dom.js';

const savedPlayer = localStorage.getItem('checkpoint_player') || '';

const state = {
  tab: 'interests',
  members: [],
  catalog: null,
  catalogError: null,
  cycle: null,
  draw: null,
  checkedIn: false,
  myInterests: blankInterests(savedPlayer),
  checkin: {
    player: savedPlayer,
    state: null,
    hours: '',
    marker: '',
    take: '',
    spoilers: 'mine',
  },
};

const TABS = [
  { id: 'interests', label: 'Interests' },
  { id: 'draw', label: 'The Draw' },
  { id: 'checkin', label: 'Check In' },
];

const app = document.querySelector('#app');

function render() {
  const view =
    state.tab === 'interests'
      ? interestsView(state, render)
      : state.tab === 'draw'
        ? drawView(state, render)
        : checkinView(state, render);

  app.innerHTML = `
    <main class="wrap">
      <header class="masthead">
        <div class="brand">${esc(CLUB.name)}</div>
        <p class="tagline">${esc(CLUB.tagline)}</p>
      </header>

      <nav class="tabs">
        ${TABS.map(
          (t) => `<button class="tab${state.tab === t.id ? ' on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`
        ).join('')}
      </nav>

      ${view.html}

      ${isDev ? '<p class="devnote">Dev mode &mdash; interests and picks are stored locally, nothing posts to Discord.</p>' : ''}
    </main>
  `;

  on(app, '[data-tab]', 'click', (e) => {
    state.tab = e.currentTarget.dataset.tab;
    render();
  });

  view.wire(app);

  if (state.tab === 'draw' && !state.catalog && !state.catalogError) loadCatalog();
}

async function loadCatalog() {
  try {
    state.catalog = await getCatalog();
  } catch (err) {
    state.catalogError = err.message;
  }
  render();
}

async function boot() {
  render();

  const [members, cycle] = await Promise.all([
    getInterests().catch(() => []),
    getCycle().catch(() => null),
  ]);
  state.members = members;
  state.cycle = cycle;

  const mine = members.find((m) => m.player.toLowerCase() === savedPlayer.toLowerCase());
  if (mine) state.myInterests = { ...blankInterests(mine.player), ...mine };
  if (cycle) state.tab = 'checkin';

  render();
}

boot();
