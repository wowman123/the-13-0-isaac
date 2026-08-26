/** Shared Monte Carlo machinery for calibrate.mjs and validate.mjs. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toScoreSpace, AXES } from '../../src/engine.js';
import { composeDraft } from '../../src/synergy.js';
import { resolveRating } from '../../src/ratings.js';
import { composeAdvanced, isAdvancedItem } from '../../src/advanced.js';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

/** Deterministic RNG so every run of the calibration is reproducible. */
export function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `n` random 5-item drafts and reduce each to its 13 raw boss scores.
 *
 * Those scores don't depend on slope or difficulty, so the solver can sweep
 * both parameters over this matrix without re-simulating anything.
 */
export function sampleScores(
  items, bosses, n, seed = 1337, draftSize = 5,
  rules = load('data/synergies.json').rules,
  transformations = load('data/transformations.json'),
) {
  const rng = mulberry32(seed);
  const ratings = items.map(resolveRating);
  const scores = new Float64Array(n * bosses.length);
  const drafts = [];

  for (let i = 0; i < n; i++) {
    const picked = new Set();
    while (picked.size < draftSize) picked.add(Math.floor(rng() * items.length));
    const idx = [...picked];
    // Synergies are part of what a draft is worth, so the difficulty has to be
    // solved against builds that include them.
    const { build } = composeDraft(idx.map((j) => items[j]), idx.map((j) => ratings[j]), rules, transformations);
    const s = toScoreSpace(build);

    for (let b = 0; b < bosses.length; b++) {
      let acc = 0;
      for (const axis of AXES) acc += (bosses[b].weights[axis] ?? 0) * s[axis];
      scores[i * bosses.length + b] = acc;
    }
    drafts.push(idx);
  }

  return { scores, drafts, nBosses: bosses.length, n };
}

/** Total 13-0 probability for every sampled draft, at these parameters. */
export function totals({ scores, nBosses, n }, bosses, slope, difficulty, out) {
  const result = out ?? new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let p = 1;
    for (let b = 0; b < nBosses; b++) {
      const x = slope * (scores[i * nBosses + b] - (bosses[b].threshold + difficulty));
      p *= 1 / (1 + Math.exp(-x));
    }
    result[i] = p;
  }
  return result;
}

/** Quickselect — a full sort per solver iteration is the wrong shape here. */
export function quantile(values, q) {
  const a = Float64Array.from(values);
  const k = Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))));
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}


/**
 * The same sampling for Advanced mode.
 *
 * Two things differ. The pool is only the items Advanced can describe — a stat
 * delta or a mechanic — because the rest are not offered there. And a build is
 * composed through the real stat curves rather than assigned ratings, which is
 * the whole point of the mode and the reason it needs its own difficulty solve.
 */
export function sampleAdvancedScores(
  items, bosses, n, seed = 1337, draftSize = 5,
  rules = load('data/synergies.json').rules,
  transformations = load('data/transformations.json'),
  statsById = load('data/item-stats.json').stats,
) {
  const pool = items.filter(
    (i) => i.scraped?.quality != null
      && (i.scraped?.pools ?? []).some((p) => !p.startsWith('greed'))
      && isAdvancedItem(i, statsById),
  );

  const rng = mulberry32(seed);
  const scores = new Float64Array(n * bosses.length);
  const drafts = [];

  for (let i = 0; i < n; i++) {
    const picked = new Set();
    while (picked.size < draftSize) picked.add(Math.floor(rng() * pool.length));
    const idx = [...picked];
    const { build } = composeAdvanced(idx.map((j) => pool[j]), statsById, rules, transformations);
    const s = toScoreSpace(build);

    for (let b = 0; b < bosses.length; b++) {
      let acc = 0;
      for (const axis of AXES) acc += (bosses[b].weights[axis] ?? 0) * s[axis];
      scores[i * bosses.length + b] = acc;
    }
    drafts.push(idx);
  }

  return { scores, drafts, nBosses: bosses.length, n, pool };
}
