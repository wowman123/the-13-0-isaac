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
import { buildDaily, shareText } from '../src/daily.js';
import { dayKey } from '../src/random.js';
import { fightAt, endlessSummary, endlessShare, HEADSTART } from '../src/endless.js';
import { bossOdds } from '../src/engine.js';
import { diagnose, diagnosisText } from '../src/diagnose.js';
import { parForDeal, parScore, parGrade } from '../src/par.js';
import { recordDay, summary } from '../src/streak.js';
import { mulberry32, hashString } from '../src/random.js';
import { ALL_POOLS, ANY_QUALITY, WILDCARD_OFFER, activeRules, inPool, qualities } from '../src/rule-items.js';
import { poolLabel as label } from '../src/pools.js';

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

/**
 * The daily is the casual ruleset on a fixed deal. Advanced draws from a
 * smaller pool and answers to its own difficulty solve, so a daily that
 * sometimes ran one and sometimes the other would not be comparable between
 * two players, let alone between two days.
 */
const isDaily = () => state.mode === 'daily';
const isEndless = () => state.mode === 'endless';
// Endless keeps the casual ruleset and only changes the shape of a run, so
// anything asking "which scoring model" should not see it as advanced.
const isAdvanced = () => state.mode === 'advanced';

const ENDLESS_BEST = 'the-13-0-endless-best';

/**
 * A run can be seeded, so a deal can be handed to somebody else.
 *
 * The daily proves the machinery works; this exposes it. With a seed in the
 * URL the draw is a pure function of it, so "beat this" is a link rather than a
 * description. Without one the page uses Math.random and every run is fresh.
 */
let runRng = null;
const rollRandom = () => (runRng ? runRng() : Math.random());
const seedFromHash = () =>
  new URLSearchParams((location.hash.split('?')[1]) ?? '').get('seed') || null;

const DAILY_STORE = 'the-13-0-daily';

/** Everything this browser has played, by day. */
function dailyHistory() {
  try {
    return JSON.parse(localStorage.getItem(DAILY_STORE) || '{}');
  } catch { return {}; }
}

function dailyResult(day = dayKey()) {
  return dailyHistory()[day] ?? null;
}

/**
 * Keep the whole history rather than only today. A daily with no memory is a
 * puzzle you do once; the streak is the reason to come back tomorrow.
 */
function saveDailyResult(day, picks, total, par, perfect) {
  try {
    localStorage.setItem(
      DAILY_STORE,
      JSON.stringify(recordDay(dailyHistory(), day, { picks, total, par, perfect })),
    );
  } catch { /* private browsing; the run still finishes, it just is not remembered */ }
}

/**
 * The exact best and worst builds today's deal allowed.
 *
 * Only possible because a daily fixes all five offers before the first pick:
 * a few thousand builds is brute force, where free play redraws after every
 * pick and has no tree to exhaust. Cached because it is the same answer all
 * day and costs about a tenth of a second.
 */
let parCache = null;
function dealPar() {
  if (!run?.daily) return null;
  if (parCache?.day === run.daily.day) return parCache.par;

  const par = parForDeal(
    run.daily.rounds,
    byId,
    (item) => state.ratings.get(item.id),
    state.bosses,
    state.config,
    state.rules,
    state.transformations,
  );
  parCache = { day: run.daily.day, par };
  return par;
}

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


const poolLabel = (pool) => label(pool, ALL_POOLS);

/** Which of the draft's own rules this build has bent, and how far. */
const rules = () => activeRules(run?.picks?.map(byId) ?? [], state.ruleItems);

/**
 * How many candidates one pedestal shows.
 *
 * The pedestal items do not widen this. In the game they give you more
 * pedestals, and a pedestal is its own draw from the pool — so they add rolls
 * rather than candidates, which is both what the item says and the only version
 * of it worth a pick. Six more items from the same intersection is barely worth
 * anything: within one Pool x Quality the items are close in value, so the
 * eighth-best is nearly the sixth-best. A second intersection is a real choice.
 */
const offerSize = () => (run?.roll?.quality === ANY_QUALITY ? WILDCARD_OFFER : OFFER);
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
  let ruleItems;

  try {
    [items, bosses, config, synergies, transformations, itemStats, characters, notes, ruleItems] = await Promise.all(
      ['data/items.json', 'data/bosses.json', 'data/config.json', 'data/synergies.json', 'data/transformations.json', 'data/item-stats.json', 'data/characters.json', 'data/notes.json', 'data/rule-items.json'].map(async (path) => {
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
  state.ruleItems = ruleItems;
  state.characters = characters.characters;
  for (const item of state.items) state.ratings.set(item.id, resolveRating(item));

  buildItemsView();
  buildFightsView();
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
  showView(['draft', 'items', 'fights', 'method'].includes(view) ? view : 'draft');

  // A finished run can be shared as a link. Restoring one shows the result
  // rather than resuming play — the rolls that produced it are gone.
  const shared = new URLSearchParams(query ?? '').get('r');
  const ids = (shared ?? '').split(',').filter(Boolean).map((x) => `COLLECTIBLE_${x}`).filter(byId);

  // Arriving at a different seed is a different deal, so it starts a new run.
  // Only a genuine page load went through startRun; changing the hash on an
  // open page fires this instead, and used to leave the old run in place.
  const seed = seedFromHash();
  if (run && !run.finished && (run.seed ?? null) !== seed) {
    startRun();
    return;
  }

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
  // Leaving the draft ends the fall with it; it belongs to a board that is no
  // longer the thing on screen.
  endDescent();
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const tab of $$('#tabs a')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/** Keep the URL in step with a finished run without spamming history entries. */
function writeHash() {
  const view = $$('.view').find((s) => !s.hidden)?.id.replace('view-', '') ?? 'draft';
  // The seed has to survive being written back, or the link that produced this
  // deal stops describing it the moment the first render happens.
  const query = [
    run?.seed ? `seed=${encodeURIComponent(run.seed)}` : null,
    run?.finished ? `r=${run.picks.map(shortId).join(',')}` : null,
  ].filter(Boolean).join('&');
  const next = query ? `#/${view}?${query}` : `#/${view}`;
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

/**
 * Everything at one Pool x Quality intersection that a roll could offer.
 *
 * A five-pick draft takes each item out of the pool once chosen, because being
 * offered something you already hold is a wasted option. Endless does not: a
 * run there can outlast the pool, and stripping the good items out of it as you
 * go turns the late game into a scrape through what is left. Duplicates stack
 * the way they do in the game — two Sad Onions really are two tear ups — and
 * only the stat side stacks, since tags are counted by distinct item.
 */
function cell(pool, quality) {
  const taken = isEndless() ? null : new Set(run.picks);
  return draftable().filter(
    (i) => (quality === ANY_QUALITY || i.scraped.quality === quality)
      && inPool(i, pool, isRealPool)
      && (!taken || !taken.has(i.id)),
  );
}

/** Every intersection with at least one item left in it. */
function viableCells() {
  const r = rules();
  // A spent wildcard is not one you still hold: Death Certificate offers the
  // whole pool once, and then the draft goes back to having axes.
  if (r.wildcards > (run.wildcardsUsed ?? 0)) {
    return [{ pool: ALL_POOLS, quality: ANY_QUALITY, wildcard: true }];
  }

  // Chaos removes the pool half, leaving one cell per quality rather than one
  // per intersection — rolling an axis that no longer exists would be theatre.
  const pools = r.combinePools
    ? [ALL_POOLS]
    : [...new Set(draftable().flatMap((i) => i.scraped.pools.filter(isRealPool)))];

  const out = [];
  for (const pool of pools) {
    for (const quality of qualities(r)) {
      if (cell(pool, quality).length) out.push({ pool, quality });
    }
  }
  return out;
}

const pickRandom = (list) => list[Math.floor(rollRandom() * list.length)];

/** Draw up to `n` distinct items, so a fat cell does not always show the same six. */
function sample(list, n) {
  const copy = [...list];
  const out = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(rollRandom() * copy.length), 1));
  return out;
}

function startRun() {
  // A restart mid-fall lands immediately: the new run is dealt now, and leaving
  // the shaft on screen over it would be a lie about which run you are in.
  endDescent();

  // A seeded run deals from the seed alone, so the same link gives everybody
  // the same draw. The daily has its own dealer and ignores this.
  run = run ?? {};
  const seed = isDaily() ? null : seedFromHash();
  runRng = seed ? mulberry32(hashString(`the-13-0:seed:${seed}`)) : null;

  const daily = isDaily() ? buildDaily(state.items) : null;

  run = {
    round: 1,
    picks: [],
    history: [], // { pool, quality, candidates: [id], chosen: id }
    roll: null,
    leaning: [],   // families this roll was bent toward, if any
    pulled: null,  // id of the item the lean put in front of you
    // A respin is a fresh draw, which would put two players on different
    // puzzles immediately. The daily has none.
    respins: isDaily() ? { pool: 0, quality: 0 } : { pool: RESPINS, quality: RESPINS },
    finished: false,
    daily,
    seed,
    rerollsUsed: 0,
    wildcardsUsed: 0,
    extras: [],   // the extra pedestals this roll put out, if any
    descent: null, // the floor a cleared endless fight just dropped you to
    // Endless resolves a fight after every pick rather than scoring five at
    // the end, so it carries the log of what it has already survived.
    fights: [],
  };

  // Replaying today shows what you already did rather than dealing again.
  const done = daily && dailyResult(daily.day);
  if (done && done.picks?.length === ROUNDS) {
    run.picks = [...done.picks];
    run.finished = true;
    run.replayed = true;
    renderRun();
    return;
  }

  rollFresh();
  renderRun();
}

/** Roll both axes. Uniform over viable cells, so a roll always has something in it. */
function rollFresh() {
  // The daily's rounds were all dealt before the first pick, so that two people
  // who choose differently still answer the same five questions.
  if (run.daily) {
    const dealt = run.daily.rounds[run.picks.length];
    run.leaning = [];
    run.pulled = null;
    run.roll = dealt ? { pool: dealt.pool, quality: dealt.quality } : null;
    run.candidates = dealt ? [...dealt.candidates] : [];
    return;
  }

  const cells = viableCells();
  const pending = pendingFamilies(run.picks.map(byId), state.transformations);
  const reachable = leaningCells(cells, pending, ({ pool, quality }) => cell(pool, quality));

  run.leaning = reachable !== cells ? pending : [];
  run.roll = reachable.length ? pickRandom(reachable) : null;
  run.candidates = [];
  run.pulled = null;
  run.extras = [];
  // The D6 recharges between rooms in the game, so its redraw comes back for
  // every round rather than being a pool of two spent whenever.
  run.rerollsUsed = 0;
  if (!run.roll) return;

  buildOffer();
}

/**
 * Fill the offer from the roll, plus one more roll per extra pedestal.
 *
 * The primary roll is the one on the header and the one the respins argue with;
 * the extras are drawn the same way it was, each landing on its own
 * intersection. An item already on the table is not added twice, so two rolls
 * that land in the same place show one set of items rather than two copies.
 */
function buildOffer() {
  const r = rules();
  const primary = cell(run.roll.pool, run.roll.quality);
  const offer = sample(primary, offerSize());

  run.extras = [];
  const cells = viableCells().filter((c) => !c.wildcard);
  for (let i = 0; i < r.extraRolls && cells.length; i++) {
    const extra = pickRandom(cells);
    run.extras.push(extra);
    for (const item of sample(cell(extra.pool, extra.quality), OFFER)) {
      if (!offer.includes(item)) offer.push(item);
    }
  }

  // The lean argues with the roll you were given, so it looks in that cell.
  run.pulled = pullCompletion(offer, primary, run.leaning ?? [], pickRandom);
  run.candidates = offer.map((i) => i.id);
}

/**
 * Respin one axis and keep the other — the asymmetry that makes a good roll on
 * one side worth protecting.
 */
/** Redraw the candidates, keeping the roll that produced them. */
function rerollOffer() {
  const r = rules();
  if (run.finished || !run.roll) return;
  if ((run.rerollsUsed ?? 0) >= r.offerRerolls) return;

  run.rerollsUsed = (run.rerollsUsed ?? 0) + 1;
  buildOffer();
  renderRun();
}

function respin(axis) {
  if (!run.roll || run.respins[axis] <= 0 || run.finished) return;

  // There is nothing to respin on an axis that no longer exists. Chaos removes
  // the pool for the rest of the run and a wildcard roll removes both for one
  // round, and either way the axis is gone rather than unlucky.
  if (axis === 'pool' && run.roll.pool === ALL_POOLS) return;
  if (axis === 'quality' && run.roll.quality === ANY_QUALITY) return;

  const { pool, quality } = run.roll;
  // A respin lands where a fresh roll could, so it honours the quality floor.
  const options = axis === 'pool'
    ? [...new Set(draftable().flatMap((i) => i.scraped.pools.filter(isRealPool)))]
        .filter((p) => p !== pool && cell(p, quality).length)
    : qualities(rules()).filter((q) => q !== quality && cell(pool, q).length);

  if (!options.length) return; // nothing else to land on; do not burn the respin

  run.respins[axis] -= 1;
  run.roll = axis === 'pool' ? { pool: pickRandom(options), quality } : { pool, quality: pickRandom(options) };
  buildOffer();
  renderRun();
}

function choose(id) {
  if (run.finished || !run.candidates.includes(id)) return;

  // A wildcard roll is spent the moment it is used, not when it is granted.
  if (run.roll?.quality === ANY_QUALITY) run.wildcardsUsed = (run.wildcardsUsed ?? 0) + 1;

  const before = new Set(findTransformations(run.picks.map(byId), state.transformations).map((t) => t.id));
  run.history.push({ ...run.roll, candidates: [...run.candidates], chosen: id });
  run.picks.push(id);
  const earned = findTransformations(run.picks.map(byId), state.transformations)
    .filter((t) => !before.has(t.id));

  if (isEndless()) {
    // The first few picks are free: the ladder expects a five-item build and
    // meeting Basement I with one is not difficulty, it is a broken opening.
    if (run.picks.length > HEADSTART) resolveFight();
    else { run.round += 1; rollFresh(); }
  } else if (run.picks.length >= ROUNDS) {
    run.finished = true;
    run.roll = null;
    run.candidates = [];
    if (run.daily) {
      const total = oddsFor(run.picks).total;
      const par = dealPar();
      const fraction = par ? parScore(total, par.totals) : null;
      saveDailyResult(
        run.daily.day, [...run.picks], total, fraction,
        Boolean(par && total >= par.best.total - 1e-12),
      );
    }
  } else {
    run.round += 1;
    rollFresh();
  }
  renderRun();
  // After the render, so the announcement lands over a board that already shows
  // the pick. A single pick can in principle finish two families, so it queues.
  const announceEarned = () => { if (earned.length) announce(earned); };

  // A cleared endless fight drops you a floor before any of that. In that order
  // because the fall is about where you now are, and a transformation is the
  // loudest thing that happens here — it should be the last word, not the one
  // the floor lands on top of.
  const drop = run.descent;
  run.descent = null;
  if (drop) descend(drop, announceEarned);
  else announceEarned();
}

/**
 * Endless: having taken an item, face the next fight with the build you now
 * have. The roll is honest — the same per-fight probability the ladder shows —
 * so a run ends when it ends and no pity is applied.
 */
function resolveFight() {
  const { build } = composeDraft(
    run.picks.map(byId),
    run.picks.map((id) => state.ratings.get(id)),
    state.rules,
    state.transformations,
  );

  const fight = fightAt(run.fights.length, state.bosses);
  const chance = bossOdds(build, fight, state.config);
  const cleared = rollRandom() < chance;

  run.fights.push({ label: fight.label, lap: fight.lap, chance, cleared });

  if (!cleared) {
    run.finished = true;
    run.roll = null;
    run.candidates = [];
    const best = Number(localStorage.getItem(ENDLESS_BEST) ?? 0);
    const cleared_ = endlessSummary(run.fights).cleared;
    if (cleared_ > best) {
      run.newBest = true;
      try { localStorage.setItem(ENDLESS_BEST, String(cleared_)); } catch { /* private browsing */ }
    }
    return;
  }

  run.round += 1;
  rollFresh();
  // What the drop is to, recorded here and spent by the render. A cleared fight
  // is the only thing in the whole site that moves you somewhere.
  run.descent = {
    depth: endlessSummary(run.fights).cleared,
    next: fightAt(run.fights.length, state.bosses).label,
  };
}

// ------------------------------------------------------------- the descent
/**
 * Endless clears a fight and you go down a floor. This is that half second.
 *
 * Decoration over a state that is already settled: the fight is rolled, the
 * next offer dealt and the page rendered before this runs, and `after` fires
 * whether the animation played, was skipped, or was cut short. A player who has
 * asked for reduced motion, or who restarts mid-fall, ends up in exactly the
 * same place as one who watched it.
 */
const DESCENT_MS = 820;
let descentTimer = null;

const wantsMotion = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function endDescent() {
  clearTimeout(descentTimer);
  descentTimer = null;
  $('#descent').hidden = true;
}

function descend(drop, after = () => {}) {
  endDescent();
  if (!wantsMotion()) { after(); return; }

  $('#descent-depth').textContent = `${drop.depth} down`;
  $('#descent-next').textContent = `Falling to ${drop.next}`;

  const pop = $('#descent');
  pop.hidden = false;
  // Force a reflow so a second fall replays rather than sitting finished.
  for (const node of pop.children) { node.style.animation = 'none'; void node.offsetWidth; node.style.animation = ''; }

  const board = $('#roll-panel');
  board.classList.remove('is-landing');
  void board.offsetWidth;
  board.classList.add('is-landing');

  descentTimer = setTimeout(() => { endDescent(); after(); }, DESCENT_MS);
}

// ------------------------------------------------------------ item detail
/**
 * Everything the site knows about one item, in one place.
 *
 * The draft shows an item for as long as it takes to decide, and the items
 * table shows a row. Neither answers "what is this, actually" — which rules it
 * takes part in, which rolls can even offer it, what its numbers are.
 */
let itemReturn = null;

function showItem(id) {
  const item = byId(id);
  if (!item) return;

  const rating = state.ratings.get(id);
  itemReturn = document.activeElement;

  $('#item-pop-sprite').replaceChildren(sprite(id));
  $('#item-pop-name').textContent = item.name;
  $('#item-pop-note').textContent = describe(item);

  const kind = { active: 'Active', familiar: 'Familiar' }[item.scraped?.type] ?? 'Passive';
  const pools = (item.scraped?.pools ?? []).filter(isRealPool);
  $('#item-pop-meta').textContent = [
    kind,
    item.scraped?.quality != null ? `Quality ${item.scraped.quality}` : null,
    rating ? `rated ${rating.source}` : null,
  ].filter(Boolean).join(' · ');

  // The five axes, on the same scale the build vector uses.
  $('#item-pop-axes').replaceChildren(...AXES.map((axis) => {
    const v = rating?.[axis] ?? NEUTRAL[axis];
    const bounded = axis === 'tracking' || axis === 'evasion';
    const width = bounded ? v * 100 : Math.max(0, Math.min(100, ((v - 0.5) / 2.5) * 100));
    return el('div', { className: 'item-axis' }, [
      el('span', { className: 'item-axis-key', textContent: axis }),
      el('span', { className: 'item-axis-bar', style: `--w: ${width.toFixed(0)}%` }),
      el('span', { className: 'item-axis-val', textContent: bounded ? v.toFixed(2) : `x${v.toFixed(2)}` }),
    ]);
  }));

  // Which rules it can take part in, and where a roll could offer it.
  const inRules = state.rules.filter((r) => {
    const tags = item.tags ?? [];
    const want = [...(r.when?.tags ?? []), ...(r.when?.tagCount ? [r.when.tagCount.tag] : [])];
    return want.some((t) => tags.includes(t)) || (r.when?.items ?? r.when?.anyItems ?? []).includes(id);
  });
  const families = (state.transformations?.transformations ?? [])
    .filter((t) => (item.tags ?? []).includes(t.family));

  const stats = state.itemStats?.[id];
  // What a rule item would do to the draft, said before you spend a pick on it
  // rather than after. Its own description says what it does in the game; this
  // says what that means here, which is the part a draft has to translate.
  const rule = (state.ruleItems?.items ?? []).find((x) => x.id === id);
  $('#item-pop-extra').replaceChildren(
    ...(rule ? [el('p', { className: 'item-pop-line' }, [
      el('b', { textContent: 'Changes the draft: ' }),
      document.createTextNode(rule.does),
    ])] : []),
    ...(stats ? [el('p', { className: 'item-pop-line' }, [
      el('b', { textContent: 'Stats: ' }),
      document.createTextNode(Object.entries(stats).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')),
    ])] : []),
    ...(families.length ? [el('p', { className: 'item-pop-line' }, [
      el('b', { textContent: 'Counts toward: ' }),
      document.createTextNode(families.map((t) => t.name).join(', ')),
    ])] : []),
    ...(inRules.length ? [el('p', { className: 'item-pop-line' }, [
      el('b', { textContent: 'Can trigger: ' }),
      document.createTextNode(inRules.map((r) => r.name).join(', ')),
    ])] : []),
    el('p', { className: 'item-pop-line' }, [
      el('b', { textContent: 'Offered by: ' }),
      document.createTextNode(pools.length ? pools.map(poolLabel).join(', ') : 'nothing a run can reach'),
    ]),
  );

  $('#item-pop').hidden = false;
  $('#item-close').focus();
}

function hideItem() {
  $('#item-pop').hidden = true;
  if (itemReturn?.isConnected) itemReturn.focus();
  itemReturn = null;
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

  // Endless has no fifth round to count towards, so it counts what it actually
  // has: how deep you are. "Round 5 of 5" was still on screen at the fortieth
  // fight, which is the one number in the mode that must never stop moving.
  $('#run-round').textContent = done
    ? 'Run complete'
    : isEndless()
      ? (run.fights.length ? `${endlessSummary(run.fights).cleared} down` : 'Before the first fight')
      : `Round ${run.round} of ${ROUNDS}`;
  $('#run-title').textContent = done ? 'Your run.' : 'Draft your build.';
  $('#roll-panel').hidden = done;
  $('#candidates-panel').hidden = done;
  // Endless is scored in fights survived, not in a thirteen-fight probability,
  // so the fight log is its result screen and the odds panel would answer a
  // question nobody asked.
  $('#results').hidden = !done || isEndless();
  // Sharing a daily posts the shape of the run without naming an item, so it
  // does not hand the answer to anybody who has not played today yet.
  $('#btn-share-daily').hidden = !(done && isDaily());
  $('#btn-share-endless').hidden = !(done && isEndless());

  renderMode();
  renderRoll();
  renderCandidates();
  renderBuildStrip();
  renderStats();
  renderPar();
  renderFights();
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
  $('#mode-note').textContent = isEndless()
    ? `One item, then one fight, for as long as you last. ${Number(localStorage.getItem(ENDLESS_BEST) ?? 0) ? `Your best is ${localStorage.getItem(ENDLESS_BEST)}.` : 'The thirteen come first, then they come again harder.'}`
    : isDaily()
    ? `Today's deal, the same for everyone. All five offers are dealt up front and there are no respins — the only thing that varies is what you take.`
    : isAdvanced()
      ? `Real stats, the game's own curves. ${draftable().length} items — only the ones the data can describe.`
      : 'Items rated on five combat axes. The whole pool is in play.';

  // Today's puzzle is one puzzle. Say plainly that this is the result they
  // already got rather than letting a replay look like a fresh attempt.
  const done = $('#daily-done');
  const showDone = isDaily() && run?.replayed;
  done.hidden = !showDone;
  done.textContent = showDone
    ? `You have already played ${run.daily.day}. This is the run you finished — a new one is dealt at midnight UTC.`
    : '';

  // Some characters do not fight with tears, so the DPS built from their stat
  // line is not what they actually do. Say so rather than printing a confident
  // number that happens to be wrong.
  const seedLine = $('#mode-seed');
  seedLine.hidden = !run?.seed;
  seedLine.textContent = run?.seed ? `Seeded run "${run.seed}" — anyone opening this link is dealt exactly this.` : '';

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

/**
 * Daily: how much of the deal you found, and how you have been doing.
 *
 * A raw score means very little on its own. 24% sounds respectable and is
 * dreadful if the deal allowed 54%; 12% sounds poor and is near perfect if 13%
 * was the ceiling. What a player wants is the share of possible builds they
 * beat, and today's deal is small enough to know that exactly.
 */
function renderPar() {
  const panel = $('#par-panel');
  panel.hidden = !(isDaily() && run.finished);
  if (panel.hidden) return;

  const par = dealPar();
  const total = oddsFor(run.picks).total;
  const fraction = par ? parScore(total, par.totals) : 0;
  const isBest = Boolean(par && total >= par.best.total - 1e-12);

  $('#par-title').textContent = `You beat ${(fraction * 100).toFixed(0)}% of possible builds`;
  $('#par-note').textContent = par
    ? `${fmtPct(total)}% out of a possible ${fmtPct(par.best.total)}% — ${parGrade(fraction, isBest)}. `
      + `Today's deal allowed ${par.count.toLocaleString()} different builds.`
    : '';

  $('#par-fill').style.setProperty('--w', `${(fraction * 100).toFixed(1)}%`);
  $('#par-you').style.setProperty('--x', `${(fraction * 100).toFixed(1)}%`);
  $('#par-scale').textContent = par
    ? `Worst build available ${fmtPct(par.worst.total)}%  ·  best ${fmtPct(par.best.total)}%`
    : '';

  // Hidden until asked for: the answer is worth having, and worth not being
  // shown before you have decided you want it.
  $('#par-reveal').hidden = isBest || Boolean(run.revealed);
  $('#par-best').hidden = !(isBest || run.revealed);
  if (isBest || run.revealed) {
    $('#par-line').replaceChildren(...(par?.best.picks ?? []).map((id) => {
      const item = byId(id);
      return el('li', { className: 'par-item', dataset: { id }, title: 'Show this item' }, [
        sprite(id),
        el('span', { textContent: item?.name ?? id }),
      ]);
    }));
  }

  renderStreaks();
}

/** The record of how this browser has done, day to day. */
function renderStreaks() {
  const s = summary(dailyHistory(), dayKey());
  const stat = (label, value) => el('div', { className: 'streak-stat' }, [
    el('span', { className: 'streak-val', textContent: String(value) }),
    el('span', { className: 'streak-key', textContent: label }),
  ]);

  const maxCount = Math.max(1, ...s.distribution.map((b) => b.count));
  $('#streaks').replaceChildren(
    el('div', { className: 'streak-row' }, [
      stat('played', s.played),
      stat('streak', s.streak),
      stat('best streak', s.best),
      stat('perfect', s.perfect),
    ]),
    s.played > 1
      ? el('div', { className: 'streak-dist' }, s.distribution.map((b) => el('div', { className: 'dist-row' }, [
          el('span', { className: 'dist-key', textContent: b.label }),
          el('span', { className: 'dist-bar', style: `--w: ${Math.round((b.count / maxCount) * 100)}%` }),
          el('span', { className: 'dist-val', textContent: String(b.count) }),
        ])))
      : null,
    el('p', {
      className: 'streak-note',
      textContent: 'Kept in this browser only — there is no account behind this, which also means clearing site data ends the streak.',
    }),
  );
}

/** Endless: the ladder you have climbed so far, and the one that stopped you. */
function renderFights() {
  const panel = $('#fights-panel');
  panel.hidden = !isEndless() || !run.fights.length;
  if (panel.hidden) return;

  const { cleared, died, luckiest } = endlessSummary(run.fights);
  const best = Number(localStorage.getItem(ENDLESS_BEST) ?? 0);

  $('#fights-title').textContent = died
    ? `${cleared} fight${cleared === 1 ? '' : 's'} cleared`
    : `${cleared} down, still going`;

  $('#fights-note').textContent = died
    ? [
        `${died.label} ended it, at ${fmtPct(died.chance)}% to clear.`,
        luckiest && luckiest.chance < 0.5 ? `You had already got past ${luckiest.label} on ${fmtPct(luckiest.chance)}%.` : '',
        run.newBest ? 'That is your deepest run yet.' : best ? `Your best is ${best}.` : '',
      ].filter(Boolean).join(' ')
    : 'Take an item, face the next fight. The build keeps growing; so does the ladder.';

  $('#fight-log').replaceChildren(
    ...run.fights.map((f) => el('li', { className: `fight-row${f.cleared ? '' : ' is-dead'}` }, [
      el('span', { className: 'fight-name', textContent: f.label }),
      el('span', {
        className: 'fight-bar',
        style: `--w: ${Math.max(2, Math.round(f.chance * 100))}%; --c: ${oddsColour(f.chance)}`,
      }),
      el('span', { className: 'fight-odds', textContent: `${fmtPct(f.chance)}%` }),
      el('span', { className: 'fight-mark', textContent: f.cleared ? '\u2713' : '\u2715' }),
    ])),
  );
}

function renderRoll() {
  // A daily has no respins to offer, so the row that holds them goes away
  // rather than sitting there greyed out.
  $('.respins').hidden = isDaily();
  if (!run.roll) return;
  $('#roll-pool').textContent = poolLabel(run.roll.pool);
  $('#roll-quality').textContent = `Q${run.roll.quality}`;

  const r = rules();
  const wild = run.roll?.quality === ANY_QUALITY;
  for (const axis of ['pool', 'quality']) {
    const left = run.respins[axis];
    const dead = wild || (axis === 'pool' && r.combinePools);
    $(`#respin-${axis}`).textContent = '';
    $(`#respin-${axis}`).append(
      `Respin ${axis} `,
      el('b', { id: `respin-${axis}-left`, textContent: String(left) }),
    );
    $(`#respin-${axis}`).disabled = left <= 0 || run.finished || dead;
    $(`#respin-${axis}`).title = dead ? 'That axis is gone — there is nothing left to respin.' : '';
  }

  // Rerolling the offer is a third kind of respin, and the only one that argues
  // with the six items rather than with the roll that produced them.
  const rerollsLeft = r.offerRerolls - (run.rerollsUsed ?? 0);
  const reroll = $('#reroll-offer');
  reroll.hidden = r.offerRerolls === 0;
  reroll.disabled = rerollsLeft <= 0 || run.finished || !run.candidates?.length;
  reroll.textContent = '';
  reroll.append('Reroll items ', el('b', { textContent: String(Math.max(0, rerollsLeft)) }));

  // Say what each rule item did, rather than leaving the roll silently changed.
  const lines = r.active.map((x) => x.does);
  if ((run.extras ?? []).length) {
    // Naming them matters: without this the extra items look like the header's
    // roll offering things it cannot offer. Two extras that landed in the same
    // place are named once, because they put out one set of items, not two.
    const where = [...new Set(run.extras.map((c) => `${poolLabel(c.pool)} \u00d7 Q${c.quality}`))];
    const list = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where.at(-1)}` : where[0];
    lines.unshift(
      `${run.extras.length === 1 ? 'An extra pedestal' : `${run.extras.length} extra pedestals`}, `
      + `rolling ${list}. Their items are on the table too.`,
    );
  }
  if (wild) lines.unshift('This roll ignores both axes. Every item in the game is on the table, once.');
  const box = $('#roll-rules');
  box.hidden = !lines.length;
  box.replaceChildren(...lines.map((t) => el('span', { className: 'rule-line', textContent: t })));

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
  const extras = (run.extras ?? []).length;
  $('#candidates-note').textContent = extras
    ? `These come from ${extras + 1} separate rolls, so they do not all sit in the same intersection.`
    : n < offerSize()
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
  // Endless has no fixed length, so the strip grows with the build rather than
  // showing five sockets that stopped meaning anything after the fifth pick.
  const slots = isEndless() ? Math.max(run.picks.length, 1) : ROUNDS;
  $('#build-strip').replaceChildren(
    ...Array.from({ length: slots }, (_, i) => {
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
  $('#ladder-why').textContent = diagnosisText(diagnose(build, perBoss, state.bosses)) ?? '';
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

      return el('tr', { className: 'is-clickable', dataset: { id: item.id }, title: 'Show everything known about this item' }, [
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
/**
 * The thirteen fights, and what each one actually asks for.
 *
 * The boss weights are the most consequential numbers in the project and the
 * only ones with no source behind them, so the page that shows them says so
 * rather than presenting them as fact.
 */
function buildFightsView() {
  const host = $('#boss-list');
  const maxWeight = Math.max(...state.bosses.flatMap((b) => Object.values(b.weights ?? {})));
  const maxThreshold = Math.max(...state.bosses.map((b) => b.threshold));

  host.replaceChildren(...state.bosses.map((boss, i) => el('div', { className: 'boss' }, [
    el('div', { className: 'boss-head' }, [
      el('span', { className: 'boss-index', textContent: String(i + 1) }),
      el('span', { className: 'boss-name', textContent: boss.name }),
      el('span', {
        className: 'boss-threshold',
        title: 'How much it takes to beat this fight.',
        textContent: `threshold ${boss.threshold.toFixed(1)}`,
      }),
    ]),
    el('div', { className: 'boss-axes' }, AXES.map((axis) => {
      const w = boss.weights?.[axis] ?? 0;
      return el('div', { className: 'boss-axis' }, [
        el('span', { className: 'boss-axis-key', textContent: axis }),
        el('span', {
          className: 'boss-axis-bar',
          style: `--w: ${Math.round((w / maxWeight) * 100)}%`,
        }),
        el('span', { className: 'boss-axis-val', textContent: w ? w.toFixed(2) : '—' }),
      ]);
    })),
    el('span', {
      className: 'boss-rise',
      style: `--w: ${Math.round((boss.threshold / maxThreshold) * 100)}%`,
      title: 'Where this fight sits on the climb.',
    }),
    boss.note ? el('p', { className: 'boss-note', textContent: boss.note }) : null,
  ])));
}

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

  // The rule items are data, so the Method page reads them off the same file the
  // draft does rather than repeating the list in prose that could drift.
  $('#rule-item-table tbody').replaceChildren(
    ...(state.ruleItems?.items ?? []).map((rule) => el('tr', {}, [
      el('td', {}, el('b', { textContent: byId(rule.id)?.name ?? rule.id })),
      el('td', {}, el('q', { textContent: rule.says })),
      el('td', { textContent: rule.does }),
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
  /**
   * Keyboard play. A draft is six choices and a restart, which is a keyboard's
   * whole job — and it is the difference between clicking through a run and
   * playing one.
   */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#transform-pop').hidden) { showNextAnnouncement(); return; }
      if (!$('#item-pop').hidden) { hideItem(); return; }
    }
    // Never steal a key from someone typing in the item search.
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('#transform-pop').hidden) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showNextAnnouncement(); }
      return;
    }
    if (!$('#descent').hidden) return;
    if ($('#view-draft').hidden) return;

    if (/^[1-9]$/.test(e.key)) {
      const id = run?.candidates?.[Number(e.key) - 1];
      if (id) { e.preventDefault(); choose(id); }
      return;
    }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); $('#btn-restart').click(); }
    if (e.key.toLowerCase() === 'p' && !$('#respin-pool').disabled) respin('pool');
    if (e.key.toLowerCase() === 'q' && !$('#respin-quality').disabled) respin('quality');
  });

  $('#par-reveal').addEventListener('click', () => { run.revealed = true; renderRun(); });
  $('#par-line').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) showItem(row.dataset.id);
  });

  $('#item-close').addEventListener('click', hideItem);
  $('#item-scrim').addEventListener('click', hideItem);

  // Any sprite or name in a candidate row opens the detail rather than picking,
  // so looking something up never costs you the draft.
  $('#candidates').addEventListener('click', (e) => {
    const info = e.target.closest('.candidate-name, .sprite');
    const row = e.target.closest('[data-pick]');
    if (info && row) { e.stopPropagation(); showItem(row.dataset.pick); }
  }, true);

  $('#btn-share-seed').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const original = button.textContent;
    const seed = run?.seed ?? Math.random().toString(36).slice(2, 8);
    const url = `${location.origin}${location.pathname}#/draft?seed=${encodeURIComponent(seed)}`;
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Copied';
    } catch { button.textContent = 'Copy failed'; }
    setTimeout(() => { button.textContent = original; }, 1600);
  });

  $('#btn-share-daily').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const par = dealPar();
    const total = oddsFor(run.picks).total;
    const text = shareText(
      run.daily.day,
      run.picks.map((id) => byId(id)?.scraped?.quality ?? 0),
      total,
      location.origin + location.pathname,
      par ? { best: par.best.total, beat: parScore(total, par.totals) } : null,
    );
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = original; }, 1600);
  });

  $('#btn-share-endless').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(
        endlessShare(run.fights, location.origin + location.pathname),
      );
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = original; }, 1600);
  });

  $('#reroll-offer').addEventListener('click', rerollOffer);
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

  $('.items-table tbody').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row) showItem(row.dataset.id);
  });

  $('.items-table thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
    renderItemsTable();
  });
}
