/**
 * Is a transformation ever the right play?
 *
 * Two questions, because either one alone is easy to fake. First the ceiling:
 * what is the best build that transforms worth against the best build that
 * ignores transformations entirely? Payouts sized below parity make the
 * mechanic a consolation prize. Second the reach: how often does a player who
 * actually chases a family finish one? Ceiling parity on a payout you collect
 * four percent of the time is cosmetic.
 *
 * Run after touching data/transformations.json or the draft rules in
 * src/draft.js. It reports, it does not write anything.
 */

import { load, mulberry32, quantile } from './lib/sim.mjs';
import { composeDraft } from '../src/synergy.js';
import { runOdds } from '../src/engine.js';
import { resolveRating } from '../src/ratings.js';
import { pendingFamilies, leaningCells, pullCompletion } from '../src/draft.js';

const { items } = load('data/items.json');
const bosses = load('data/bosses.json');
const config = load('data/config.json');
const rules = load('data/synergies.json').rules;
const spec = load('data/transformations.json');

const isRealPool = (p) => !p.startsWith('greed');
const pool = items.filter((i) => i.scraped?.quality != null && (i.scraped?.pools ?? []).some(isRealPool));
const REAL_POOLS = [...new Set(pool.flatMap((i) => i.scraped.pools.filter(isRealPool)))];
const ratings = new Map(pool.map((i) => [i.id, resolveRating(i)]));

const odds = (its) => {
  const { build, transformed } = composeDraft(its, its.map((i) => ratings.get(i.id)), rules, spec);
  return { total: runOdds(build, bosses, config).total, transformed };
};

// ------------------------------------------------------------------ ceilings
/** Hill-climb one slot at a time. Cheap, and the surface is not adversarial. */
function climb(start, score) {
  let cur = [...start];
  let best = score(cur);
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    for (let slot = 0; slot < 5; slot++) {
      for (let cand = 0; cand < pool.length; cand++) {
        if (cur.includes(cand)) continue;
        const next = cur.map((v, i) => (i === slot ? cand : v));
        const v = score(next);
        if (v > best + 1e-12) { best = v; cur = next; improved = true; }
      }
    }
    if (!improved) break;
  }
  return { best, cur };
}

const score = (idx) => odds(idx.map((j) => pool[j])).total;
const scoreTransformed = (idx) => (odds(idx.map((j) => pool[j])).transformed.length ? score(idx) : -1);
const solo = pool.map((_, j) => ({ j, v: score([j]) })).sort((a, b) => b.v - a.v);

let anyBuild = { best: 0, cur: [] };
for (let a = 0; a < 8; a++) {
  for (let b = a + 1; b < 9; b++) {
    const seed = [...new Set([solo[a].j, solo[b].j, solo[(a + 4) % 20].j, solo[(b + 7) % 20].j, solo[(a + b + 2) % 20].j])];
    if (seed.length !== 5) continue;
    const r = climb(seed, score);
    if (r.best > anyBuild.best) anyBuild = r;
  }
}

// Seed each family's climb with its three best members plus the two best items
// overall, so the search starts somewhere that already transforms.
let transformedBuild = { best: 0, cur: [], name: null };
for (const t of spec.transformations) {
  const family = pool.map((it, j) => ({ it, j })).filter((x) => (x.it.tags ?? []).includes(t.family));
  if (family.length < spec.threshold) continue;
  const ranked = family.map((x) => x.j).sort((a, b) => score([b]) - score([a]));
  const seed = [...new Set([ranked[0], ranked[1], ranked[2], solo[0].j, solo[1].j])];
  if (seed.length !== 5) continue;
  const r = climb(seed, scoreTransformed);
  if (r.best > transformedBuild.best) transformedBuild = { ...r, name: t.name };
}

// ---------------------------------------------------------------------- play
/**
 * One run under the real draft rules, played by one of two crude agents:
 * `odds` takes whatever candidate raises the build most, `chase` banks family
 * progress first and falls back to odds. Neither plays as well as a person, so
 * read the gap between them rather than either number on its own.
 */
function playRun(rng, agent) {
  const picks = [];
  const taken = new Set();
  let respins = 3;

  const cell = (p, q) => pool.filter(
    (i) => i.scraped.quality === q && i.scraped.pools.includes(p) && !taken.has(i.id),
  );
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const sample = (list, n) => {
    const copy = [...list];
    const out = [];
    while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(rng() * copy.length), 1));
    return out;
  };

  for (let round = 0; round < 5; round++) {
    const cells = [];
    for (const p of REAL_POOLS) for (let q = 0; q <= 4; q++) if (cell(p, q).length) cells.push({ p, q });

    const families = pendingFamilies(picks, spec);
    const reachable = leaningCells(cells, families, ({ p, q }) => cell(p, q));
    const leaning = reachable !== cells;

    let { p, q } = pick(reachable);
    if (respins > 0 && q <= 2 && !leaning) {
      const options = [0, 1, 2, 3, 4].filter((x) => x !== q && cell(p, x).length);
      if (options.length) { respins -= 1; q = pick(options); }
    }

    const cellItems = cell(p, q);
    const offer = sample(cellItems, 6);
    if (leaning) pullCompletion(offer, cellItems, families, pick);
    if (!offer.length) continue;

    let chosen = offer[0];
    let bestKey = -Infinity;
    const census = {};
    for (const it of picks) for (const tag of (it.tags ?? [])) census[tag] = (census[tag] ?? 0) + 1;
    const live = agent === 'chase'
      ? spec.transformations
          .filter((t) => (census[t.family] ?? 0) < spec.threshold
            && spec.threshold - (census[t.family] ?? 0) <= 5 - picks.length)
          .map((t) => t.family)
      : [];

    for (const c of offer) {
      const progress = Math.max(0, ...live.map((f) => ((c.tags ?? []).includes(f) ? (census[f] ?? 0) + 1 : 0)), 0);
      const key = progress * 1000 + odds([...picks, c]).total;
      if (key > bestKey) { bestKey = key; chosen = c; }
    }

    picks.push(chosen);
    taken.add(chosen.id);
  }

  const { total, transformed } = odds(picks);
  return { total, transformed: transformed.length > 0 };
}

function play(agent, n, seed = 90210) {
  const rng = mulberry32(seed);
  const totals = [];
  let transformed = 0;
  for (let i = 0; i < n; i++) {
    const r = playRun(rng, agent);
    totals.push(r.total);
    if (r.transformed) transformed += 1;
  }
  return {
    median: quantile(totals, 0.5),
    p90: quantile(totals, 0.9),
    mean: totals.reduce((a, b) => a + b, 0) / totals.length,
    rate: transformed / n,
  };
}

// -------------------------------------------------------------------- report
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const N = Number(process.argv[2] ?? 500);
const names = (idx) => idx.map((j) => pool[j].name).join(', ');
const gap = (transformedBuild.best - anyBuild.best) * 100;

console.log('ceilings');
console.log(`  best build overall     ${pct(anyBuild.best)}  ${names(anyBuild.cur)}`);
console.log(`  best that transforms   ${pct(transformedBuild.best)}  [${transformedBuild.name}] ${names(transformedBuild.cur)}`);
console.log(`  gap                    ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} points`);
console.log(`\nplay (${N.toLocaleString()} runs each)`);
const played = {};
for (const agent of ['odds', 'chase']) {
  const r = play(agent, N);
  played[agent] = r;
  console.log(`  ${agent.padEnd(6)} median ${pct(r.median)}  mean ${pct(r.mean)}  p90 ${pct(r.p90)}  transformed ${pct(r.rate)}`);
}

/**
 * The ceiling gap above is reported, not asserted. Near the top of the curve a
 * percentage point is not the same size as one in the middle — 97% against 98%
 * is a much smaller edge than 20% against 21% — so a fixed points threshold
 * says nothing useful once the best builds saturate.
 *
 * What actually has to hold is about the decision a player faces, and it is
 * bounded on both sides. Chasing a family must cost something, or it is a free
 * lunch and every draft becomes the same hunt; and it must not cost so much
 * that taking the odds is always right, which is where this started.
 */
const { odds: o, chase: c } = played;
const problems = [];
if (c.median > o.median && c.mean > o.mean) {
  problems.push(`chasing beats playing for odds on both median and mean (${pct(c.median)}/${pct(c.mean)} vs ${pct(o.median)}/${pct(o.mean)}) — payouts are too generous, the chase is a free lunch`);
}
if (c.mean < o.mean * 0.85) {
  problems.push(`chasing gives up ${((1 - c.mean / o.mean) * 100).toFixed(0)}% of mean score — payouts are too small for it ever to be correct`);
}
if (c.rate < 0.10) {
  problems.push(`a player chasing families only completes one ${pct(c.rate)} of the time — the payout is unreachable, so its size is cosmetic`);
}

if (problems.length) {
  console.log();
  for (const p of problems) console.log(`FAIL: ${p}`);
  process.exit(1);
}
console.log('\nchasing is a real option: it costs a little and it lands often enough to be worth choosing.');
