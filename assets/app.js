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
  draft: [null, null, null, null, null], // item ids
  pickingSlot: null,
  sort: { key: 'offense', dir: -1 },
};

const DRAFT_SIZE = 5;
const shortId = (id) => id.replace(/^COLLECTIBLE_/, '');
const byId = (id) => state.items.find((i) => i.id === id);
const pct = (p) => p * 100;

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

async function init() {
  const [items, bosses, config] = await Promise.all([
    fetch('data/items.json').then((r) => r.json()),
    fetch('data/bosses.json').then((r) => r.json()),
    fetch('data/config.json').then((r) => r.json()),
  ]);

  state.items = items.items;
  state.scrapeLayer = items.scrapeLayer;
  state.bosses = bosses;
  state.config = config;
  for (const item of state.items) state.ratings.set(item.id, resolveRating(item));

  buildSlots();
  buildItemsView();
  buildMethodView();
  wireEvents();

  readHash();
  window.addEventListener('hashchange', readHash);
}

// ---------------------------------------------------------------- routing
function readHash() {
  const hash = location.hash.slice(1);
  const [path, query] = hash.split('?');
  const view = (path.replace(/^\//, '') || 'draft').split('/')[0];
  showView(['draft', 'items', 'method'].includes(view) ? view : 'draft');

  const d = new URLSearchParams(query ?? '').get('d');
  if (d != null) {
    const ids = d.split(',').filter(Boolean).map((s) => `COLLECTIBLE_${s}`);
    const next = [null, null, null, null, null];
    ids.slice(0, DRAFT_SIZE).forEach((id, i) => {
      if (byId(id)) next[i] = id;
    });
    state.draft = next;
  }
  renderDraft();
}

function showView(view) {
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const tab of $$('#tabs a')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/** Keep the URL in step with the draft without spamming history entries. */
function writeHash() {
  const picked = state.draft.filter(Boolean).map(shortId);
  const view = $$('.view').find((s) => !s.hidden)?.id.replace('view-', '') ?? 'draft';
  const next = picked.length ? `#/${view}?d=${picked.join(',')}` : `#/${view}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

// ---------------------------------------------------------------- draft
function buildSlots() {
  $('#slots').replaceChildren(
    ...Array.from({ length: DRAFT_SIZE }, (_, i) => el('li', {}, el('button', { className: 'slot', dataset: { slot: i } }))),
  );
}

function renderDraft() {
  renderSlots();

  const picked = state.draft.filter(Boolean);
  const ratings = picked.map((id) => state.ratings.get(id));
  const build = composeBuild(ratings);
  const { perBoss, total } = runOdds(build, state.bosses, state.config);
  const complete = picked.length === DRAFT_SIZE;

  renderHero(total, complete, picked.length);
  renderAxes(build, complete);
  renderLadder(perBoss, complete);
  renderSwaps(complete, total);
  writeHash();
}

function renderSlots() {
  for (const [i, button] of $$('#slots .slot').entries()) {
    const id = state.draft[i];
    const item = id ? byId(id) : null;
    button.classList.toggle('is-empty', !item);

    if (!item) {
      button.replaceChildren(el('span', { textContent: '+ pick an item' }));
      continue;
    }

    const r = state.ratings.get(id);
    button.replaceChildren(
      el('span', { className: 'slot-index', textContent: `SLOT ${i + 1}` }),
      el('span', { className: 'slot-name', textContent: item.name }),
      el('span', { className: 'slot-tags' }, [
        ...item.tags.slice(0, 3).map((t) => el('span', { className: 'tag', textContent: t })),
        r.source !== 'hand' ? el('span', { className: 'tag', textContent: r.source }) : null,
      ]),
      el('button', { className: 'slot-remove', textContent: '×', title: `Remove ${item.name}`, dataset: { remove: i } }),
    );
  }
}

function renderHero(total, complete, count) {
  $('#odds-value').textContent = complete ? fmtPct(total) : '—';
  $('#odds-fill').style.width = complete ? `${Math.min(100, pct(total) * 2)}%` : '0%';

  const verdict = $('#odds-verdict');
  if (!complete) {
    verdict.textContent = `${DRAFT_SIZE - count} more item${DRAFT_SIZE - count === 1 ? '' : 's'} to go.`;
    verdict.style.color = 'var(--dim)';
    return;
  }

  const p = pct(total);
  const [text, colour] =
    p >= 40 ? ['God roll. This is the run you tell people about.', 'var(--gold)']
    : p >= 20 ? ['Genuinely strong. This clears more often than it does not fail.', 'var(--gold)']
    : p >= 8 ? ['Above the median draft. Playable.', 'var(--ax-evasion)']
    : p >= 2 ? ['Right around the median. Most runs look like this.', 'var(--muted)']
    : ['Below median. Something here has to carry.', 'var(--blood)'];

  verdict.textContent = text;
  verdict.style.color = colour;
}

function renderAxes(build, complete) {
  // Scale each bar against roughly the 99th percentile of composed drafts, not
  // against the single-item range — otherwise every bar either sits near empty
  // or pins at full. A genuine god roll can still exceed these and clamp.
  const scale = { offense: 5.0, aoe: 4.0, defense: 4.0, tracking: 1, evasion: 1 };
  const multiplicative = (axis) => axis === 'offense' || axis === 'aoe' || axis === 'defense';

  $('#axes').replaceChildren(
    ...AXES.map((axis) => {
      const v = complete ? build[axis] : NEUTRAL[axis];
      const width = Math.min(100, (v / scale[axis]) * 100);
      const neutralAt = multiplicative(axis) ? (1 / scale[axis]) * 100 : 0;

      return el('div', { className: 'axis', style: `--c: var(--ax-${axis})` }, [
        el('span', { className: 'axis-name', textContent: axis }),
        el('div', { className: 'axis-track' }, [
          neutralAt > 0 ? el('span', { className: 'axis-neutral', style: `left:${neutralAt}%` }) : null,
          el('div', { className: 'axis-bar', style: `width:${complete ? width : 0}%` }),
        ]),
        el('span', {
          className: `axis-val${v === NEUTRAL[axis] ? ' is-neutral' : ''}`,
          textContent: complete ? (multiplicative(axis) ? `×${v.toFixed(2)}` : v.toFixed(2)) : '—',
        }),
      ]);
    }),
  );
}

function renderLadder(perBoss, complete) {
  // Only the first fight at the minimum is flagged, so a tie doesn't light up
  // half the ladder.
  const worstIndex = complete
    ? perBoss.reduce((best, b, i) => (b.p < perBoss[best].p ? i : best), 0)
    : -1;

  $('#ladder').replaceChildren(
    ...perBoss.map((b, i) => {
      const isWorst = i === worstIndex;
      const special = b.id === 'BOSS_DELIRIUM' || b.id === 'BOSS_THE_BEAST';
      // Green through amber to red as the fight gets less likely.
      const hue = Math.round(b.p * 120);

      return el('li', {
        className: `ladder-row${isWorst ? ' is-worst' : ''}${special ? ' is-special' : ''}`,
        title: state.bosses.find((x) => x.id === b.id)?.note ?? '',
      }, [
        el('span', { className: 'ladder-i', textContent: b.index }),
        el('span', { className: 'ladder-name', textContent: b.name }),
        el('div', { className: 'ladder-track' }, el('div', {
          className: 'ladder-bar',
          style: `width:${complete ? pct(b.p) : 0}%; background: hsl(${hue} 62% 52%)`,
        })),
        el('span', { className: 'ladder-val', textContent: complete ? `${pct(b.p).toFixed(0)}%` : '—' }),
      ]);
    }),
  );
}

/**
 * Try every unpicked item in every slot. 187 items x 5 slots x 13 fights is
 * small enough to brute-force on every render.
 */
function renderSwaps(complete, current) {
  const host = $('#swaps');
  if (!complete) {
    host.replaceChildren(el('p', { className: 'empty-note', textContent: 'Fill all five slots to see what would improve this draft.' }));
    return;
  }

  const inDraft = new Set(state.draft);
  const candidates = [];

  for (let slot = 0; slot < DRAFT_SIZE; slot++) {
    for (const item of state.items) {
      if (inDraft.has(item.id)) continue;
      const trial = state.draft.map((id, i) => (i === slot ? item.id : id));
      const { total } = runOdds(
        composeBuild(trial.map((id) => state.ratings.get(id))),
        state.bosses,
        state.config,
      );
      if (total > current) candidates.push({ slot, item, total, gain: total - current });
    }
  }

  if (!candidates.length) {
    host.replaceChildren(el('p', { className: 'empty-note', textContent: 'Nothing in the set improves this draft. That is as good as it gets.' }));
    return;
  }

  candidates.sort((a, b) => b.gain - a.gain);

  host.replaceChildren(
    ...candidates.slice(0, 5).map((c) =>
      el('button', { className: 'swap', dataset: { slot: c.slot, swap: c.item.id } }, [
        el('span', { className: 'swap-text' }, [
          el('span', { className: 'swap-out', textContent: `slot ${c.slot + 1} · ${byId(state.draft[c.slot]).name} → ` }),
          el('span', { className: 'swap-in', textContent: c.item.name }),
        ]),
        el('span', { className: 'swap-delta', textContent: `${fmtPct(c.total)}%  (+${(pct(c.gain)).toFixed(1)})` }),
      ]),
    ),
  );
}

// ---------------------------------------------------------------- picker
function openPicker(slot) {
  state.pickingSlot = slot;
  $('#picker-search').value = '';
  renderPickerList('');
  $('#picker').showModal();
  $('#picker-search').focus();
}

function renderPickerList(query) {
  const q = query.trim().toLowerCase();
  const picked = new Set(state.draft.filter(Boolean));

  const matches = state.items
    .filter((i) => !q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q)) || (i.rated?.note ?? '').toLowerCase().includes(q))
    .sort((a, b) => state.ratings.get(b.id).offense - state.ratings.get(a.id).offense)
    .slice(0, 120);

  if (!matches.length) {
    $('#picker-list').replaceChildren(el('li', { className: 'picker-empty', textContent: `Nothing matches "${query}".` }));
    return;
  }

  $('#picker-list').replaceChildren(
    ...matches.map((item) => {
      const r = state.ratings.get(item.id);
      const vec = `${r.offense.toFixed(2)} · ${r.aoe.toFixed(2)} · ${r.tracking.toFixed(2)} · ${r.defense.toFixed(2)} · ${r.evasion.toFixed(2)}`;
      return el('li', {}, el('button', {
        className: 'picker-item',
        dataset: picked.has(item.id) ? { pick: item.id, picked: '' } : { pick: item.id },
      }, [
        el('span', { className: 'picker-name', textContent: item.name }),
        el('span', { className: 'picker-vec', textContent: vec }),
        item.rated?.note ? el('span', { className: 'picker-note', textContent: item.rated.note }) : null,
      ]));
    }),
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
        el('td', { className: 'col-name', textContent: item.name }),
        ...AXES.map(cell),
        item.scraped?.quality != null
          ? el('td', { textContent: `Q${item.scraped.quality}` })
          : el('td', {}, el('span', { className: 'q-pending', textContent: 'not scraped' })),
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
    .map(([q, v]) => `Q${q} → ${v.toFixed(2)}`)
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
  $('#slots').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      e.stopPropagation();
      state.draft[Number(remove.dataset.remove)] = null;
      renderDraft();
      return;
    }
    const slot = e.target.closest('[data-slot]');
    if (slot) openPicker(Number(slot.dataset.slot));
  });

  $('#picker-list').addEventListener('click', (e) => {
    const button = e.target.closest('[data-pick]');
    if (!button) return;
    const id = button.dataset.pick;
    // Picking something already in the draft moves it rather than duplicating.
    const existing = state.draft.indexOf(id);
    if (existing !== -1) state.draft[existing] = null;
    state.draft[state.pickingSlot] = id;
    $('#picker').close();
    renderDraft();
  });

  $('#picker-search').addEventListener('input', (e) => renderPickerList(e.target.value));
  $('#picker-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    $('#picker-list .picker-item')?.click();
  });

  $('#swaps').addEventListener('click', (e) => {
    const button = e.target.closest('[data-swap]');
    if (!button) return;
    state.draft[Number(button.dataset.slot)] = button.dataset.swap;
    renderDraft();
  });

  $('#btn-random').addEventListener('click', () => {
    const pool = [...state.items];
    const picked = [];
    while (picked.length < DRAFT_SIZE && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
    }
    state.draft = picked;
    renderDraft();
  });

  $('#btn-clear').addEventListener('click', () => {
    state.draft = [null, null, null, null, null];
    renderDraft();
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
