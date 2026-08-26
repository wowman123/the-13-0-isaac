/**
 * Site front-end. All of the arithmetic comes from the same modules the
 * calibration solver and the test suite use — nothing is reimplemented here.
 */

import { runOdds, AXES, NEUTRAL } from '../src/engine.js';
import { composeDraft, findSynergies, synergyStrength, transformationProgress, findTransformations } from '../src/synergy.js';
import { resolveRating, TAG_TABLE, QUALITY_OFFENSE } from '../src/ratings.js';
import { pendingFamilies, leaningCells, pullCompletion } from '../src/draft.js';
import { composeAdvanced, isAdvancedItem } from '../src/advanced.js';
import { composeStats, baselineStats, BASE } from '../src/stats.js';

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
  // 'casual' rates items on five assigned axes; 'advanced' runs the game's own
  // stat curves over the numbers the game actually publishes.
  mode: localStorage.getItem('the-13-0-mode') === 'advanced' ? 'advanced' : 'casual',
  character: localStorage.getItem('the-13-0-character') || 'ISAAC',
};

const isAdvanced = () => state.mode === 'advanced';

/** The starting stat line for whoever is selected. Isaac unless chosen. */
const activeCharacter = () =>
  state.characters?.find((c) => c.id === state.character) ?? { id: 'ISAAC', name: 'Isaac', stats: {} };

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
  let synergies;
  let transformations;
  let itemStats;
  let characters;
  let notes;

  try {
    [items, bosses, config, synergies, transformations, itemStats, characters, notes] = await Promise.all(
      ['data/items.json', 'data/bosses.json', 'data/config.json', 'data/synergies.json', 'data/transformations.json', 'data/item-stats.json', 'data/characters.json', 'data/notes.json'].map(async (path) => {
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
  state.rules = synergies.rules;
  state.transformations = transformations;
  state.itemStats = itemStats.stats;
  state.itemText = itemStats.text ?? {};
  state.notes = notes.notes ?? {};
  state.characters = characters.characters;
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
    (i) => i.scraped?.quality != null
      && (i.scraped?.pools ?? []).some(isRealPool)
      // Advanced offers only items it can actually describe. An item with no
      // stat delta and no mechanic would be a pick worth literally nothing.
      && (!isAdvanced() || isAdvancedItem(i, state.itemStats)),
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
    leaning: [],   // families this roll was bent toward, if any
    pulled: null,  // id of the item the lean put in front of you
    respins: { pool: RESPINS, quality: RESPINS },
    finished: false,
  };
  rollFresh();
  renderRun();
}

/** Roll both axes. Uniform over viable cells, so a roll always has something in it. */
function rollFresh() {
  const cells = viableCells();
  const pending = pendingFamilies(run.picks.map(byId), state.transformations);
  const reachable = leaningCells(cells, pending, ({ pool, quality }) => cell(pool, quality));

  run.leaning = reachable !== cells ? pending : [];
  run.roll = reachable.length ? pickRandom(reachable) : null;
  run.candidates = [];
  run.pulled = null;
  if (!run.roll) return;

  const offer = sample(cell(run.roll.pool, run.roll.quality), OFFER);
  run.pulled = pullCompletion(offer, cell(run.roll.pool, run.roll.quality), run.leaning, pickRandom);
  run.candidates = offer.map((i) => i.id);
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
  const cellItems = cell(run.roll.pool, run.roll.quality);
  const offer = sample(cellItems, OFFER);
  run.pulled = pullCompletion(offer, cellItems, run.leaning ?? [], pickRandom);
  run.candidates = offer.map((i) => i.id);
  renderRun();
}

function choose(id) {
  if (run.finished || !run.candidates.includes(id)) return;

  const before = new Set(findTransformations(run.picks.map(byId), state.transformations).map((t) => t.id));
  run.history.push({ ...run.roll, candidates: [...run.candidates], chosen: id });
  run.picks.push(id);
  const earned = findTransformations(run.picks.map(byId), state.transformations)
    .filter((t) => !before.has(t.id));

  if (run.picks.length >= ROUNDS) {
    run.finished = true;
    run.roll = null;
    run.candidates = [];
  } else {
    run.round += 1;
    rollFresh();
  }
  renderRun();
  // After the render, so the announcement lands over a board that already shows
  // the pick. A single pick can in principle finish two families, so it queues.
  if (earned.length) announce(earned);
}

// ------------------------------------------------------- the announcement
/**
 * Three of a family is the loudest thing that happens in a five-pick draft, and
 * a badge in a side panel was not carrying it. The run stops and says so.
 */
let announceQueue = [];
let announceReturn = null;

function announce(list) {
  announceQueue = [...announceQueue, ...list];
  if (!$('#transform-pop').hidden) return; // already showing; it will drain
  announceReturn = document.activeElement;
  showNextAnnouncement();
}

function showNextAnnouncement() {
  const t = announceQueue.shift();
  const pop = $('#transform-pop');

  if (!t) {
    pop.hidden = true;
    pop.classList.remove('is-open');
    if (announceReturn?.isConnected) announceReturn.focus();
    else $('#btn-restart')?.focus();
    announceReturn = null;
    return;
  }

  $('#transform-pop-name').textContent = t.name;
  $('#transform-pop-note').textContent = t.note ?? '';
  $('#transform-pop-effect').textContent = effectLabel(t);

  // The three items that did it, in the order they were taken.
  const trio = run.picks.map(byId).filter((i) => (i.tags ?? []).includes(t.family)).slice(0, t.need);
  $('#transform-trio').replaceChildren(
    ...trio.map((item, i) => el('li', {
      className: 'transform-piece',
      style: `--step: ${i}`,
      title: item.name,
    }, [sprite(item.id), el('span', { textContent: item.name })])),
  );

  $('#transform-go').textContent = run.finished ? 'See the damage' : 'Continue';
  pop.hidden = false;
  // Force a reflow so the entry animation replays on a second announcement.
  pop.classList.remove('is-open');
  void pop.offsetWidth;
  pop.classList.add('is-open');
  $('#transform-go').focus();
}

/** Odds for an arbitrary set of item ids, synergies included. */
function oddsFor(ids) {
  const items = ids.map((id) => byId(id));

  if (isAdvanced()) {
    // Advanced has its own difficulty solve: it reaches the same five axes by a
    // different road, so its spread of drafts is a different distribution.
    const config = { ...state.config, ...state.config.advanced };
    const { build, stats, fired, transformed } = composeAdvanced(
      items, state.itemStats, state.rules, state.transformations, activeCharacter().stats,
    );
    return { build, stats, fired, transformed, ...runOdds(build, state.bosses, config) };
  }

  const { build, fired, transformed } = composeDraft(
    items,
    ids.map((id) => state.ratings.get(id)),
    state.rules,
    state.transformations,
  );
  return { build, fired, transformed, ...runOdds(build, state.bosses, state.config) };
}

/**
 * What taking this candidate does to transformation progress: completing one is
 * a milestone, and moving from one to two is why the third pick later matters.
 */
function transformPreview(candidateId) {
  const held = run.picks.map(byId);
  const before = new Map(transformationProgress(held, state.transformations).map((t) => [t.id, t.held]));
  return transformationProgress([...held, byId(candidateId)], state.transformations)
    // A fourth item of a family you have already transformed adds nothing, so
    // it must not advertise "completes" a second time.
    .filter((t) => t.held > (before.get(t.id) ?? 0) && (before.get(t.id) ?? 0) < t.need)
    .map((t) => ({ ...t, completes: t.held >= t.need }));
}

/**
 * Which rules taking this candidate would newly trigger. This is what turns a
 * pick from "which number is biggest" into "which one fits what I have".
 */
/**
 * What to say about an item, best answer first.
 *
 *   1. the hand-rated note, for the 181 items that have one
 *   2. a hand-written note on whether it is worth a pick — these exist for the
 *      items a player is offered most, and answer a different question from
 *      the description below it: what an item does is not whether to take it
 *   3. the sourced one-line description of what it actually does
 *   4. a sentence generated from its tags, for the stat-ups that need no prose
 *
 * Nothing here is invented. Steps 3 and 4 are the game's own data in words, and
 * step 2 is an opinion about data from step 3 rather than a claim about
 * mechanics. Before any of this existed a row printed its raw tag list —
 * "Tags: nolostbr, health_up" — which is internal vocabulary and said nothing.
 */
const MECHANIC_WORDS = {
  homing: 'homing shots', laser: 'fires a laser', piercing: 'piercing shots',
  explosive: 'explosive shots', knife: 'a knife instead of tears',
  orbital: 'an orbital', familiar: 'a familiar that fights for you',
  dot: 'damage over time', spectral: 'spectral shots',
  multishot: 'extra shots', charged: 'a charged shot', flight: 'flight',
};

const STAT_WORDS = {
  damage_up: 'damage', tears_up: 'fire rate', range_up: 'range',
  shot_speed: 'shot speed', speed_up: 'speed', luck_up: 'luck',
  health_up: 'health', soul_hearts: 'soul hearts', black_hearts: 'black hearts',
};

/** "a, b and c" — an item that moves four stats should not read like a CSV. */
const list = (parts) => (parts.length < 2
  ? (parts[0] ?? '')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

function describe(item) {
  if (item.rated?.note) return item.rated.note;
  if (state.notes?.[item.id]) return state.notes[item.id];
  if (state.itemText?.[item.id]) return state.itemText[item.id];

  const tags = item.tags ?? [];
  const kind = { active: 'Active item', familiar: 'Familiar' }[item.scraped?.type] ?? 'Passive';
  const mechanics = Object.keys(MECHANIC_WORDS).filter((t) => tags.includes(t) && t !== 'familiar');
  const stats = Object.keys(STAT_WORDS).filter((t) => tags.includes(t));

  const sentences = [`${kind}.`];
  if (mechanics.length) sentences.push(`Gives ${list(mechanics.map((t) => MECHANIC_WORDS[t]))}.`);
  if (stats.length) sentences.push(`Raises ${list(stats.map((t) => STAT_WORDS[t]))}.`);

  // "Active item." and "Familiar." already tell a drafter what they are picking,
  // so they stand on their own. A bare passive genuinely says nothing, and the
  // data has nothing more to give: no cache entry means the effect is scripted
  // in the game rather than declared. Say that plainly rather than padding it.
  if (sentences.length === 1 && kind === 'Passive') {
    sentences.push('Effect not described in the item data.');
  }

  return sentences.join(' ');
}

function synergyPreview(candidateId) {
  const held = run.picks.map(byId);
  const already = new Set(findSynergies(held, state.rules).map((r) => r.id));
  return findSynergies([...held, byId(candidateId)], state.rules).filter((r) => !already.has(r.id));
}

// ---------------------------------------------------------------- rendering
function renderRun() {
  const done = run.finished;

  $('#run-round').textContent = done ? 'Run complete' : `Round ${run.round} of ${ROUNDS}`;
  $('#run-title').textContent = done ? 'Your run.' : 'Draft your build.';
  $('#roll-panel').hidden = done;
  $('#candidates-panel').hidden = done;
  $('#results').hidden = !done;

  renderMode();
  renderRoll();
  renderCandidates();
  renderBuildStrip();
  renderStats();
  renderProgress();

  if (done) renderResults();
  writeHash();
}

// ---------------------------------------------------------------- mode
function renderMode() {
  for (const btn of $$('.mode-btn')) {
    const on = btn.dataset.mode === state.mode;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
  }
  $('#mode-char-wrap').hidden = !isAdvanced();

  const character = activeCharacter();
  $('#mode-note').textContent = isAdvanced()
    ? `Real stats, the game's own curves. ${draftable().length} items — only the ones the data can describe.`
    : 'Items rated on five combat axes. The whole pool is in play.';

  // Some characters do not fight with tears, so the DPS built from their stat
  // line is not what they actually do. Say so rather than printing a confident
  // number that happens to be wrong.
  const caveat = $('#mode-caveat');
  const show = isAdvanced() && Boolean(character.caveat);
  caveat.hidden = !show;
  caveat.textContent = show ? character.caveat : '';
}

/** The stat line, which only Advanced has. */
function renderStats() {
  const panel = $('#stats-panel');
  panel.hidden = !isAdvanced();
  if (!isAdvanced()) return;

  const character = activeCharacter();
  const stats = composeStats(
    run.picks.map((id) => state.itemStats[id]).filter(Boolean),
    character.stats,
  );
  const base = composeStats([], character.stats);

  $('#stats-note').textContent = `${character.name}, ${run.picks.length} of ${ROUNDS} picks. `
    + `Damage and fire rate use the game's own formulas; the rest are the deltas the game publishes.`;

  const row = (label, value, was, hint) => el('div', { className: 'stat-cell', title: hint ?? '' }, [
    el('span', { className: 'stat-key', textContent: label }),
    el('span', { className: 'stat-val', textContent: value }),
    was != null ? el('span', { className: 'stat-was', textContent: was }) : null,
  ]);

  const delta = (now, then, digits = 2) => {
    const d = now - then;
    if (Math.abs(d) < 0.005) return null;
    return `${d > 0 ? '+' : ''}${d.toFixed(digits)}`;
  };

  $('#stat-line').replaceChildren(
    row('DPS', stats.dps.toFixed(1), delta(stats.dps, base.dps, 1), 'Damage multiplied by tears per second.'),
    row('Damage', stats.damage.toFixed(2), delta(stats.damage, base.damage), 'base x sqrt(ups x 1.2 + 1)'),
    row('Tears/s', stats.fireRate.toFixed(2), delta(stats.fireRate, base.fireRate), `${stats.tearDelay} frames between shots`),
    row('Range', stats.range.toFixed(1), delta(stats.range, base.range, 1)),
    row('Shot speed', stats.shotSpeed.toFixed(2), delta(stats.shotSpeed, base.shotSpeed)),
    row('Speed', stats.speed.toFixed(2), delta(stats.speed, base.speed), 'Capped at 2.00 in game.'),
    row('Luck', stats.luck.toFixed(1), delta(stats.luck, base.luck, 1)),
    row('Health', `${stats.health}\u2665 ${stats.soulHearts ? `+${stats.soulHearts}` : ''}`.trim(), null),
  );
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

  // When the roll was bent toward a family you are two into, say so. A hidden
  // thumb on the scale would just read as luck.
  const lean = $('#roll-lean');
  const names = (run.leaning ?? [])
    .map((f) => state.transformations.transformations.find((t) => t.family === f)?.name)
    .filter(Boolean);
  lean.hidden = !names.length;
  lean.textContent = names.length
    ? `You are two into ${names.join(' and ')}, so this roll went looking for the third.`
    : '';
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
      const preview = synergyPreview(id);
      const gains = preview.filter((r) => !r.conflict);
      const clashes = preview.filter((r) => r.conflict);
      const forms = transformPreview(id);

      return el('li', {}, el('button', {
        className: `candidate${id === run.pulled ? ' is-pulled' : ''}`,
        dataset: { pick: id },
      }, [
        sprite(id),
        el('span', { className: 'candidate-body' }, [
          el('span', { className: 'candidate-name', textContent: item.name }),
          el('span', { className: 'candidate-note', textContent: describe(item) }),
          preview.length || forms.length
            ? el('span', { className: 'candidate-syn' }, [
                ...(id === run.pulled
                  ? [el('span', { className: 'syn-tag is-pulled', textContent: 'The run put this here' })]
                  : []),
                ...forms.map((t) => el('span', {
                  className: `syn-tag is-form${t.completes ? ' is-complete' : ''}`,
                  title: t.note,
                  textContent: t.completes ? `Completes ${t.name}` : `${t.name} ${t.held}/${t.need}`,
                })),
                ...gains.map((r) => el('span', { className: 'syn-tag', title: r.note, textContent: r.name })),
                ...clashes.map((r) => el('span', { className: 'syn-tag is-clash', title: r.note, textContent: r.name })),
              ])
            : null,
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

/** Families you are partway into, so a third pick is an informed choice. */
function renderProgress() {
  const host = $('#progress');
  const partial = transformationProgress(run.picks.map(byId), state.transformations)
    .filter((t) => t.held < t.need);

  $('#progress-panel').hidden = run.finished || !partial.length;
  if (!partial.length) return;

  host.replaceChildren(
    ...partial.map((t) => el('div', { className: 'progress-row', title: t.note }, [
      el('span', { className: 'progress-name', textContent: t.name }),
      el('span', { className: 'progress-pips' },
        Array.from({ length: t.need }, (_, i) =>
          el('i', { className: `pip${i < t.held ? ' is-on' : ''}` }))),
      el('span', { className: 'progress-count', textContent: `${t.held}/${t.need}` }),
    ])),
  );
}

function renderResults() {
  const { build, perBoss, total, fired, transformed } = oddsFor(run.picks);
  renderTransformed(transformed);
  renderHero(total);
  renderAxes(build);
  renderLadder(perBoss);
  renderSynergies(fired);
  renderPassed(total);
}

function renderTransformed(transformed) {
  $('#transformed-panel').hidden = !transformed.length;
  if (!transformed.length) return;
  $('#transformed').replaceChildren(
    ...transformed.map((t) => el('div', { className: 'synergy is-form' }, [
      el('span', { className: 'synergy-name', textContent: t.name }),
      el('span', { className: 'synergy-effect', textContent: effectLabel(t) }),
      el('span', { className: 'synergy-note', textContent: t.note }),
    ])),
  );
}

/** What the five items did to each other, strongest first. */
function renderSynergies(fired) {
  const host = $('#synergies');
  if (!fired.length) {
    host.replaceChildren(el('p', {
      className: 'empty-note',
      textContent: 'Five items that do not interact. No combination fired, and nothing cancelled either.',
    }));
    return;
  }

  const sorted = [...fired].sort((a, b) => synergyStrength(b) - synergyStrength(a));
  host.replaceChildren(
    ...sorted.map((r) => el('div', { className: `synergy${r.conflict ? ' is-clash' : ''}` }, [
      el('span', { className: 'synergy-name', textContent: r.name }),
      el('span', { className: 'synergy-note', textContent: r.note }),
      el('span', { className: 'synergy-effect', textContent: effectLabel(r) }),
    ])),
  );
}

/** A rule's effect as something readable, e.g. "offense x1.18 · tracking 0.95". */
function effectLabel(rule) {
  const parts = [];
  for (const axis of ['offense', 'aoe', 'defense']) {
    if (rule.effect?.[axis] != null) parts.push(`${axis} ×${rule.effect[axis]}`);
  }
  for (const axis of ['tracking', 'evasion']) {
    if (rule.effect?.[axis] != null) parts.push(`${axis} ${rule.conflict ? '≤' : '≥'} ${rule.effect[axis]}`);
  }
  return parts.join(' · ');
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
  // Per-fight odds alone are hard to read: thirteen bars all sit near the same
  // height and none of them is the number at the top of the page. What people
  // actually want to know is where runs end, so the bar tracks how many runs
  // are still alive on arrival. It starts near full, decays, and its last value
  // IS the headline figure — the chart and the number finally agree.
  let alive = 1;
  const rows = perBoss.map((b) => {
    const before = alive;
    alive *= b.p;
    return { ...b, reach: before, survive: alive, drop: before - alive };
  });

  // The fight that ends the most runs, which is not always the one with the
  // worst odds — a coin flip late costs less than a small risk taken early.
  const deadliest = rows.reduce((worst, r, i) => (r.drop > rows[worst].drop ? i : worst), 0);

  $('#ladder').replaceChildren(
    ...rows.map((r, i) => {
      const special = r.id === 'BOSS_DELIRIUM' || r.id === 'BOSS_THE_BEAST';
      const lost = Math.round(r.drop * 100);
      return el('li', {
        className: `ladder-row${i === deadliest ? ' is-worst' : ''}${special ? ' is-special' : ''}`,
        title: `${r.name}: clears ${pct(r.p).toFixed(0)}% of the time. Of 100 runs starting out, ${Math.round(r.survive * 100)} are still alive after it.`,
      }, [
        el('span', { className: 'ladder-i', textContent: r.index }),
        el('span', { className: 'ladder-name', textContent: r.name }),
        el('span', { className: 'ladder-clear', textContent: `${pct(r.p).toFixed(0)}%` }),
        el('div', { className: 'ladder-track' }, el('div', {
          className: 'ladder-bar',
          style: `width:${Math.max(0.6, pct(r.survive))}%; background:${oddsColour(r.survive)}`,
        })),
        el('span', { className: 'ladder-val', textContent: `${pct(r.survive) < 1 ? pct(r.survive).toFixed(1) : Math.round(pct(r.survive))}` }),
      ]);
    }),
  );

  const worst = rows[deadliest];
  $('#ladder-legend').textContent =
    `${worst.name} ends the most runs — ${Math.round(worst.drop * 100)} of every 100 that start.`;
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

  const describe = (when) => [
    when.tags?.length ? when.tags.join(' + ') : null,
    ...Object.entries(when.tagCount ?? {}).map(([t, n]) => `${n}x ${t}`),
    when.withoutTags?.length ? `no ${when.withoutTags.join('/')}` : null,
  ].filter(Boolean).join(', ');

  $('#synergy-table tbody').replaceChildren(
    ...state.rules.map((r) => el('tr', { className: r.conflict ? 'is-clash' : '' }, [
      el('td', {}, el('b', { textContent: r.name })),
      el('td', {}, el('code', { textContent: describe(r.when) })),
      el('td', { textContent: effectLabel(r) }),
    ])),
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

  for (const btn of $$('.mode-btn')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.mode) return;
      state.mode = btn.dataset.mode;
      localStorage.setItem('the-13-0-mode', state.mode);
      // The pools differ between modes, so a half-played run cannot carry over.
      announceQueue = [];
      if (!$('#transform-pop').hidden) showNextAnnouncement();
      history.replaceState(null, '', '#/draft');
      startRun();
    });
  }

  const charSelect = $('#mode-char');
  const group = (label, list) => (list.length
    ? el('optgroup', { label }, list.map((c) => el('option', { value: c.id, textContent: c.name, title: c.note ?? '' })))
    : null);
  charSelect.replaceChildren(
    group('Characters', state.characters.filter((c) => !c.tainted)),
    group('Tainted', state.characters.filter((c) => c.tainted)),
  );
  // A stored character from an older build may no longer be in the list.
  if (!state.characters.some((c) => c.id === state.character)) state.character = 'ISAAC';
  charSelect.value = state.character;
  charSelect.addEventListener('change', () => {
    state.character = charSelect.value;
    localStorage.setItem('the-13-0-character', state.character);
    history.replaceState(null, '', '#/draft');
    startRun();
  });

  $('#transform-go').addEventListener('click', showNextAnnouncement);
  $('#transform-scrim').addEventListener('click', showNextAnnouncement);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#transform-pop').hidden) showNextAnnouncement();
  });

  $('#respin-pool').addEventListener('click', () => respin('pool'));
  $('#respin-quality').addEventListener('click', () => respin('quality'));
  $('#btn-restart').addEventListener('click', () => {
    announceQueue = [];
    if (!$('#transform-pop').hidden) showNextAnnouncement();
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
