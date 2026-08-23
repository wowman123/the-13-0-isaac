/**
 * Site front-end. All of the arithmetic comes from the same modules the
 * calibration solver and the test suite use — nothing is reimplemented here.
 */

import { composeBuild, runOdds, AXES, NEUTRAL } from '../src/engine.js';
import { resolveRating, TAG_TABLE, QUALITY_OFFENSE } from '../src/ratings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = (tag, props = {}, children = []) => {
  const { dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  // dataset is a readonly DOMStringMap — it has to be written key by key.
  for (const [k, v] of Object.entries(dataset ?? {})) node.dataset[k] = v;
  for (const c of [children].flat()) if (c != null) node.append(c);
  return node;
};

// ---------------------------------------------------------------- state
const state = {
  items: [],
  bosses: [],
  config: null,
  ratings: new Map(), // id -> resolved vector
  sort: { key: 'offense', dir: -1 },
};

const ROUNDS = 5;
const OFFER = 6;
const RESPINS = 3;

/** A single playthrough. Rebuilt from scratch by startRun(). */
let run;

/**
 * Greed-mode pools are a separate game; rolling them here would offer items
 * you cannot reach on the run being simulated.
 */
const isRealPool = (pool) => !pool.startsWith('greed');

const POOL_LABELS = {
  treasure: 'Treasure Room',
  shop: 'Shop',
  boss: 'Boss Room',
  devil: 'Devil Room',
  angel: 'Angel Room',
  secret: 'Secret Room',
  ultrasecret: 'Ultra Secret Room',
  curse: 'Curse Room',
  library: 'Library',
  cranegame: 'Crane Game',
  beggar: 'Beggar',
  demonbeggar: 'Devil Beggar',
  rottenbeggar: 'Rotten Beggar',
  goldenchest: 'Golden Chest',
  redchest: 'Red Chest',
  oldchest: 'Old Chest',
  wooden: 'Wooden Chest',
  bombbum: 'Bomb Bum',
  babyshop: 'Baby Shop',
  planetarium: 'Planetarium',
  moms: "Mom's Chest",
};

const poolLabel = (pool) => POOL_LABELS[pool] ?? pool.replace(/^\w/, (c) => c.toUpperCase());
const shortId = (id) => id.replace(/^COLLECTIBLE_/, '');
const byId = (id) => state.items.find((i) => i.id === id);
const pct = (p) => p * 100;

const sprite = (id) => el('img', {
  className: 'sprite', src: `assets/sprites/${id}.png`,
  alt: '', loading: 'lazy', width: 64, height: 64,
  // Sprite art is optional and separately licensed. If assets/sprites has been
  // removed, collapse the image rather than leaving a broken icon everywhere.
  onerror() { this.remove(); },
});

/** Coral through amber to green — the same scale the guess feedback uses. */
function oddsColour(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return `hsl(${2 + clamped * 140} 74% ${72 - clamped * 8}%)`;
}

/** Two significant-ish digits, but never "0.0%" for something non-zero. */
function fmtPct(p) {
  const v = pct(p);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v > 0 && v < 0.01) return '<0.01';
  return v.toFixed(3);
}

// ---------------------------------------------------------------- boot
init();
registerServiceWorker();

/**
 * Offline support. Service workers need a secure context, so this is a no-op
 * over plain http on a LAN address — the site still works, it just will not
 * install or run offline there.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('service worker registration failed:', err.message);
    });
  });
}

async function init() {
  let items;
  let bosses;
  let config;

  try {
    [items, bosses, config] = await Promise.all(
      ['data/items.json', 'data/bosses.json', 'data/config.json'].map(async (path) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`${path} returned ${res.status}`);
        return res.json();
      }),
    );
  } catch (err) {
    showLoadFailure(err);
    return;
  }

  state.items = items.items;
  state.scrapeLayer = items.scrapeLayer;
  state.bosses = bosses;
  state.config = config;
  for (const item of state.items) state.ratings.set(item.id, resolveRating(item));

  buildItemsView();
  buildMethodView();
  wireEvents();

  readHash();
  window.addEventListener('hashchange', readHash);
}

/** The page is useless without its data, so say so instead of sitting blank. */
function showLoadFailure(err) {
  document.querySelector('main').replaceChildren(
    el('section', { className: 'panel load-error' }, [
      el('h2', { textContent: 'Could not load the item data' }),
      el('p', { textContent: String(err.message ?? err) }),
      el('p', { textContent: 'This site reads data/*.json over HTTP. Opening index.html straight from disk will not work — serve the folder instead (npm start).' }),
    ]),
  );
}

// ---------------------------------------------------------------- routing
function readHash() {
  const hash = location.hash.slice(1);
  const [path, query] = hash.split('?');
  const view = (path.replace(/^\//, '') || 'draft').split('/')[0];
  showView(['draft', 'items', 'method'].includes(view) ? view : 'draft');

  // A finished run can be shared as a link. Restoring one shows the result
  // rather than resuming play — the rolls that produced it are gone.
  const shared = new URLSearchParams(query ?? '').get('r');
  const ids = (shared ?? '').split(',').filter(Boolean).map((x) => `COLLECTIBLE_${x}`).filter(byId);

  if (ids.length === ROUNDS && (!run || run.picks.join() !== ids.join())) {
    run = {
      round: ROUNDS, picks: ids, history: [], roll: null,
      candidates: [], respins: { pool: 0, quality: 0 }, finished: true, shared: true,
    };
    renderRun();
  } else if (!run) {
    startRun();
  }
}

function showView(view) {
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const tab of $$('#tabs a')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/** Keep the URL in step with a finished run without spamming history entries. */
function writeHash() {
  const view = $$('.view').find((s) => !s.hidden)?.id.replace('view-', '') ?? 'draft';
  const next = run?.finished
    ? `#/${view}?r=${run.picks.map(shortId).join(',')}`
    : `#/${view}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

// ---------------------------------------------------------------- the run
/** Items a roll can actually reach: in a real pool, and with a quality. */
function draftable() {
  return state.items.filter(
    (i) => i.scraped?.quality != null && (i.scraped?.pools ?? []).some(isRealPool),
  );
}

/** Everything at one Pool x Quality intersection that is not already taken. */
function cell(pool, quality) {
  const taken = new Set(run.picks);
  return draftable().filter(
    (i) => i.scraped.quality === quality && i.scraped.pools.includes(pool) && !taken.has(i.id),
  );
}

/** Every intersection with at least one item left in it. */
function viableCells() {
  const pools = [...new Set(draftable().flatMap((i) => i.scraped.pools.filter(isRealPool)))];
  const out = [];
  for (const pool of pools) {
    for (let quality = 0; quality <= 4; quality++) {
      if (cell(pool, quality).length) out.push({ pool, quality });
    }
  }
  return out;
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

/** Draw up to `n` distinct items, so a fat cell does not always show the same six. */
function sample(list, n) {
  const copy = [...list];
  const out = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(Math.random() * copy.length), 1));
  return out;
}

function startRun() {
  run = {
    round: 1,
    picks: [],
    history: [], // { pool, quality, candidates: [id], chosen: id }
    roll: null,
    respins: { pool: RESPINS, quality: RESPINS },
    finished: false,
  };
  rollFresh();
  renderRun();
}

/** Roll both axes. Uniform over viable cells, so a roll always has something in it. */
function rollFresh() {
  const cells = viableCells();
  run.roll = cells.length ? pickRandom(cells) : null;
  run.candidates = run.roll ? sample(cell(run.roll.pool, run.roll.quality), OFFER).map((i) => i.id) : [];
}

/**
 * Respin one axis and keep the other — the asymmetry that makes a good roll on
 * one side worth protecting.
 */
function respin(axis) {
  if (!run.roll || run.respins[axis] <= 0 || run.finished) return;

  const { pool, quality } = run.roll;
  const options = axis === 'pool'
    ? [...new Set(draftable().flatMap((i) => i.scraped.pools.filter(isRealPool)))]
        .filter((p) => p !== pool && cell(p, quality).length)
    : [0, 1, 2, 3, 4].filter((q) => q !== quality && cell(pool, q).length);

  if (!options.length) return; // nothing else to land on; do not burn the respin

  run.respins[axis] -= 1;
  run.roll = axis === 'pool' ? { pool: pickRandom(options), quality } : { pool, quality: pickRandom(options) };
  run.candidates = sample(cell(run.roll.pool, run.roll.quality), OFFER).map((i) => i.id);
  renderRun();
}

function choose(id) {
  if (run.finished || !run.candidates.includes(id)) return;

  run.history.push({ ...run.roll, candidates: [...run.candidates], chosen: id });
  run.picks.push(id);

  if (run.picks.length >= ROUNDS) {
    run.finished = true;
    run.roll = null;
    run.candidates = [];
  } else {
    run.round += 1;
    rollFresh();
  }
  renderRun();
}

/** Odds for an arbitrary set of item ids. */
function oddsFor(ids) {
  const build = composeBuild(ids.map((id) => state.ratings.get(id)));
  return { build, ...runOdds(build, state.bosses, state.config) };
}

// ---------------------------------------------------------------- rendering
function renderRun() {
  const done = run.finished;

  $('#run-round').textContent = done ? 'Run complete' : `Round ${run.round} of ${ROUNDS}`;
  $('#run-title').textContent = done ? 'Your run.' : 'Draft your build.';
  $('#roll-panel').hidden = done;
  $('#candidates-panel').hidden = done;
  $('#results').hidden = !done;

  renderRoll();
  renderCandidates();
  renderBuildStrip();

  if (done) renderResults();
  writeHash();
}

function renderRoll() {
  if (!run.roll) return;
  $('#roll-pool').textContent = poolLabel(run.roll.pool);
  $('#roll-quality').textContent = `Q${run.roll.quality}`;

  for (const axis of ['pool', 'quality']) {
    const left = run.respins[axis];
    $(`#respin-${axis}-left`).textContent = left;
    $(`#respin-${axis}`).disabled = left <= 0 || run.finished;
  }
}

function renderCandidates() {
  const host = $('#candidates');
  if (!run.candidates?.length) {
    host.replaceChildren();
    return;
  }

  $('#candidates-title').textContent = `Choose 1 of ${run.candidates.length}`;
  const n = run.candidates.length;
  $('#candidates-note').textContent = n < OFFER
    ? `Only ${n} item${n === 1 ? '' : 's'} sit${n === 1 ? 's' : ''} where those two rolls cross. Thin intersections are part of the game.`
    : 'These are the items sitting where those two rolls cross.';

  host.replaceChildren(
    ...run.candidates.map((id) => {
      const item = byId(id);
      return el('li', {}, el('button', { className: 'candidate', dataset: { pick: id } }, [
        sprite(id),
        el('span', { className: 'candidate-body' }, [
          el('span', { className: 'candidate-name', textContent: item.name }),
          el('span', { className: 'candidate-note', textContent: item.rated?.note ?? `Tags: ${item.tags.join(', ') || 'none'}` }),
        ]),
        el('span', { className: 'candidate-take', textContent: 'Take' }),
      ]));
    }),
  );
}

function renderBuildStrip() {
  $('#build-strip').replaceChildren(
    ...Array.from({ length: ROUNDS }, (_, i) => {
      const id = run.picks[i];
      if (!id) {
        return el('li', { className: 'build-cell is-empty' }, el('span', { textContent: i + 1 }));
      }
      const item = byId(id);
      return el('li', { className: 'build-cell', title: item.name }, [
        sprite(id),
        el('span', { className: 'build-cell-name', textContent: item.name }),
      ]);
    }),
  );
}

function renderResults() {
  const { build, perBoss, total } = oddsFor(run.picks);
  renderHero(total);
  renderAxes(build);
  renderLadder(perBoss);
  renderPassed(total);
}

function renderHero(total) {
  $('#odds-value').textContent = fmtPct(total);
  const fill = $('#odds-fill');
  fill.style.width = `${Math.max(2, Math.min(100, pct(total)))}%`;
  fill.style.background = oddsColour(total / 0.5);

  const p = pct(total);
  const [text, colour] =
    p >= 40 ? ['God roll. The run you tell people about.', 'var(--ax-evasion)']
    : p >= 20 ? ['Genuinely strong. This clears more often than it fails.', 'var(--ax-evasion)']
    : p >= 8 ? ['Above the median draft. Playable.', 'var(--ink)']
    : p >= 2 ? ['Right around the median. Most runs look like this.', 'var(--ink-soft)']
    : ['Below median. Something here had to carry, and did not.', 'var(--red)'];

  const verdict = $('#odds-verdict');
  verdict.textContent = text;
  verdict.style.color = colour;
}

function renderAxes(build) {
  // Scale each bar against roughly the 99th percentile of composed drafts, not
  // against the single-item range — otherwise every bar either sits near empty
  // or pins at full. A genuine god roll can still exceed these and clamp.
  const scale = { offense: 5.0, aoe: 4.0, defense: 4.0, tracking: 1, evasion: 1 };
  const multiplicative = (axis) => axis === 'offense' || axis === 'aoe' || axis === 'defense';

  $('#axes').replaceChildren(
    ...AXES.map((axis) => {
      const v = build[axis];
      const width = Math.min(100, (v / scale[axis]) * 100);
      const neutralAt = multiplicative(axis) ? (1 / scale[axis]) * 100 : 0;

      return el('div', { className: 'axis', style: `--c: var(--ax-${axis})` }, [
        el('span', { className: 'axis-name', textContent: axis }),
        el('div', { className: 'axis-track' }, [
          neutralAt > 0 ? el('span', { className: 'axis-neutral', style: `left:${neutralAt}%` }) : null,
          el('div', { className: 'axis-bar', style: `width:${width}%` }),
        ]),
        el('span', {
          className: `axis-val${v === NEUTRAL[axis] ? ' is-neutral' : ''}`,
          textContent: multiplicative(axis) ? `×${v.toFixed(2)}` : v.toFixed(2),
        }),
      ]);
    }),
  );
}

function renderLadder(perBoss) {
  // Only the first fight at the minimum is flagged, so a tie doesn't light up
  // half the ladder.
  const worstIndex = perBoss.reduce((best, b, i) => (b.p < perBoss[best].p ? i : best), 0);

  $('#ladder').replaceChildren(
    ...perBoss.map((b, i) => {
      const special = b.id === 'BOSS_DELIRIUM' || b.id === 'BOSS_THE_BEAST';
      return el('li', {
        className: `ladder-row${i === worstIndex ? ' is-worst' : ''}${special ? ' is-special' : ''}`,
        title: state.bosses.find((x) => x.id === b.id)?.note ?? '',
      }, [
        el('span', { className: 'ladder-i', textContent: b.index }),
        el('span', { className: 'ladder-name', textContent: b.name }),
        el('div', { className: 'ladder-track' }, el('div', {
          className: 'ladder-bar',
          style: `width:${pct(b.p)}%; background:${oddsColour(b.p)}`,
        })),
        el('span', { className: 'ladder-val', textContent: `${pct(b.p).toFixed(0)}%` }),
      ]);
    }),
  );
}

/**
 * The strongest item declined in each round, and what taking it would have been
 * worth. Only the one pick is swapped; every other round stands as played.
 */
function renderPassed(actual) {
  const rows = run.history.map((h, round) => {
    let best = null;
    for (const id of h.candidates) {
      if (id === h.chosen) continue;
      const alt = run.picks.map((p, i) => (i === round ? id : p));
      const { total } = oddsFor(alt);
      if (!best || total > best.total) best = { id, total };
    }
    return best ? { round, ...best, chosen: h.chosen } : null;
  }).filter(Boolean);

  const regrets = rows.filter((r) => r.total > actual).sort((a, b) => b.total - a.total);

  if (!regrets.length) {
    $('#passed').replaceChildren(el('p', {
      className: 'empty-note',
      textContent: 'You took the best item on offer in every round. Nothing you passed would have scored higher.',
    }));
    return;
  }

  $('#passed').replaceChildren(
    ...regrets.slice(0, 5).map((r) => el('div', { className: 'swap' }, [
      el('span', { className: 'swap-text' }, [
        el('span', { className: 'swap-out', textContent: `round ${r.round + 1} · took ${byId(r.chosen).name}, passed ` }),
        el('span', { className: 'swap-in', textContent: byId(r.id).name }),
      ]),
      el('span', { className: 'swap-delta', textContent: `${fmtPct(r.total)}%  (+${(pct(r.total - actual)).toFixed(1)})` }),
    ])),
  );
}

// ---------------------------------------------------------------- items view
function buildItemsView() {
  const tags = [...new Set(state.items.flatMap((i) => i.tags))].sort();
  $('#item-tag').replaceChildren(
    el('option', { value: '', textContent: 'All tags' }),
    ...tags.map((t) => el('option', { value: t, textContent: t })),
  );
  renderItemsTable();
}

function renderItemsTable() {
  const q = $('#item-search').value.trim().toLowerCase();
  const tag = $('#item-tag').value;
  const { key, dir } = state.sort;

  const rows = state.items
    .filter((i) => !tag || i.tags.includes(tag))
    .filter((i) => !q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q)) || (i.rated?.note ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * -dir;
      if (key === 'quality') return ((a.scraped?.quality ?? -1) - (b.scraped?.quality ?? -1)) * dir;
      return (state.ratings.get(a.id)[key] - state.ratings.get(b.id)[key]) * dir;
    });

  $('#item-count').textContent = `${rows.length} of ${state.items.length}`;

  for (const th of $$('.items-table th[data-sort]')) {
    if (th.dataset.sort === key) th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  $('.items-table th.col-quality').hidden = !state.scrapeLayer;

  $('#items-body').replaceChildren(
    ...rows.map((item) => {
      const r = state.ratings.get(item.id);
      const cell = (axis) => {
        const v = r[axis];
        const neutral = v === NEUTRAL[axis];
        const strong = axis === 'offense' || axis === 'aoe' ? v >= 1.5 : axis === 'defense' ? v >= 1.4 : v >= 0.6;
        return el('td', { className: neutral ? 'is-neutral' : strong ? 'is-strong' : '', textContent: v.toFixed(2) });
      };

      return el('tr', {}, [
        el('td', { className: 'col-name' }, [sprite(item.id), el('span', { textContent: item.name })]),
        ...AXES.map(cell),
        state.scrapeLayer
          ? el('td', { textContent: item.scraped?.quality != null ? `Q${item.scraped.quality}` : '—' })
          : null,
        el('td', { className: 'col-note', textContent: item.rated?.note ?? `auto-rated from tags: ${item.tags.join(', ') || 'none'}` }),
      ]);
    }),
  );
}

// ---------------------------------------------------------------- method view
function buildMethodView() {
  const c = state.config;

  $('#provenance').replaceChildren(
    el('p', { style: 'margin:0' }, [
      state.scrapeLayer
        ? 'The scrape layer is present, so quality and pool data on this site come straight out of the game files.'
        : el('span', {}, [
            el('b', { textContent: 'The scrape layer is not present in this build. ' }),
            'Every record carries ', el('code', { textContent: 'scraped: null' }),
            ' rather than a quality number somebody guessed. Point ',
            el('code', { textContent: 'tools/scrape.mjs' }),
            ' at a game install and rebuild to fill it in.',
          ]),
    ]),
  );

  $('#quality-fallback').textContent = Object.entries(QUALITY_OFFENSE)
    .map(([q, v]) => `Q${q} » ${v.toFixed(2)}`)
    .join(' · ');

  const fmtMult = (v) => (v == null ? '—' : `×${v}`);
  $('#tag-table tbody').replaceChildren(
    ...Object.entries(TAG_TABLE).map(([tag, e]) => {
      const other = [
        e.defense ? `defense ×${e.defense}` : null,
        e.evasion ? `evasion +${e.evasion}` : null,
        e.trackingMult ? `tracking ×${e.trackingMult}` : null,
      ].filter(Boolean).join(', ');
      return el('tr', {}, [
        el('td', {}, el('code', { textContent: tag })),
        el('td', { textContent: fmtMult(e.offense) }),
        el('td', { textContent: fmtMult(e.aoe) }),
        el('td', { textContent: e.tracking != null ? e.tracking.toFixed(2) : '—' }),
        el('td', { textContent: other || '' }),
      ]);
    }),
  );

  $('#boss-table tbody').replaceChildren(
    ...state.bosses.map((b) => el('tr', {}, [
      el('td', { textContent: b.index }),
      el('td', { textContent: b.name }),
      ...AXES.map((a) => el('td', { textContent: b.weights[a].toFixed(2) })),
      el('td', { textContent: b.threshold.toFixed(2) }),
    ])),
  );

  for (const key of $$('.axis-key')) key.style.setProperty('--c', `var(--ax-${key.dataset.axis})`);

  const stat = (label, value) => el('div', {}, [el('dt', { textContent: label }), el('dd', { textContent: value })]);
  $('#calibration').replaceChildren(
    el('p', { style: 'margin:0', textContent: `Solved on ${c.solvedAt} over ${c.targets.drafts.toLocaleString()} random drafts of ${state.items.length} items:` }),
    el('dl', { className: 'callout-grid' }, [
      stat('slope', c.slope),
      stat('difficulty', c.difficulty),
      stat('median target', `${pct(c.targets.median).toFixed(0)}%`),
      stat('top 1% target', `${pct(c.targets.p99).toFixed(0)}%`),
    ]),
  );
}

// ---------------------------------------------------------------- events
function wireEvents() {
  $('#candidates').addEventListener('click', (e) => {
    const button = e.target.closest('[data-pick]');
    if (button) choose(button.dataset.pick);
  });

  $('#respin-pool').addEventListener('click', () => respin('pool'));
  $('#respin-quality').addEventListener('click', () => respin('quality'));
  $('#btn-restart').addEventListener('click', () => {
    history.replaceState(null, '', '#/draft');
    startRun();
  });

  $('#btn-share').addEventListener('click', async (e) => {
    writeHash();
    const button = e.currentTarget;
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = 'Copied';
    } catch {
      button.textContent = location.href; // clipboard blocked — show it instead
    }
    setTimeout(() => { button.textContent = original; }, 1600);
  });

  $('#item-search').addEventListener('input', renderItemsTable);
  $('#item-tag').addEventListener('change', renderItemsTable);

  $('.items-table thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
    renderItemsTable();
  });
}
