#!/usr/bin/env node
/**
 * The schema's validation list, as a runnable suite.
 *
 * Checks that depend on the scrape layer report PENDING rather than FAIL when
 * data/scraped.json has not been generated — a missing scrape is a known state
 * of the repo, not a broken dataset. Everything else fails hard.
 */

import { load, sampleScores, totals, quantile } from './lib/sim.mjs';
import { resolveRating } from '../src/ratings.js';

const N_VERIFY = 100_000;

const bosses = load('data/bosses.json');
const config = load('data/config.json');
const { items, scrapeLayer } = load('data/items.json');

const results = [];
const check = (name, status, detail) => results.push({ name, status, detail });

// 1a. Every item carries at least one tag.
const untagged = items.filter((i) => !i.tags?.length);
check(
  'every item has at least one tag',
  untagged.length ? 'FAIL' : 'PASS',
  untagged.length ? `${untagged.length} untagged: ${untagged.slice(0, 5).map((i) => i.id).join(', ')}` : `${items.length} items`,
);

// 1b. Every item has a quality and at least one pool. Needs the scrape layer.
if (!scrapeLayer) {
  check('every item has quality + at least one pool', 'PENDING', 'no scrape layer — run tools/scrape.mjs against a game install');
} else {
  const noQuality = items.filter((i) => i.scraped?.quality == null);
  const noPool = items.filter((i) => !i.scraped?.pools?.length);
  const bad = noQuality.length + noPool.length;
  check(
    'every item has quality + at least one pool',
    bad ? 'FAIL' : 'PASS',
    bad ? `${noQuality.length} missing quality, ${noPool.length} missing pools` : `${items.length} items`,
  );
}

// 1c. Every item has art. This is the check that catches an entry which is not
// actually a collectible — a trinket or a card will have no collectible sprite.
const spriteIds = new Set(load('data/sprites.json').sprites);
const artless = items.filter((i) => !spriteIds.has(i.id));
check(
  'every item has sprite art',
  artless.length ? 'FAIL' : 'PASS',
  artless.length
    ? `${artless.length} without art (is it actually a collectible?): ${artless.slice(0, 5).map((i) => i.name).join(', ')}`
    : `${spriteIds.size} sprites`,
);

// 2. Coverage: how much of the set is still riding on auto defaults.
const bySource = {};
for (const item of items) {
  const src = resolveRating(item).source;
  bySource[src] = (bySource[src] ?? 0) + 1;
}
const hand = bySource.hand ?? 0;
const auto = items.length - hand;
check(
  'rating coverage',
  'INFO',
  `${hand} hand-rated, ${auto} auto (${Object.entries(bySource).filter(([k]) => k !== 'hand').map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}) — ${((hand / items.length) * 100).toFixed(1)}% hand`,
);

// 3. No single item exceeds offense 3.0.
const overpowered = items.filter((i) => resolveRating(i).offense > 3.0);
check(
  'no item exceeds offense 3.0',
  overpowered.length ? 'FAIL' : 'PASS',
  overpowered.length ? overpowered.map((i) => `${i.id} @ ${resolveRating(i).offense}`).join(', ') : `max ${Math.max(...items.map((i) => resolveRating(i).offense)).toFixed(2)}`,
);

// 4 + 5. Calibration, on a fresh 100k sample with a different seed than the
// solver used — otherwise this only proves the solver can fit its own sample.
console.log(`simulating ${N_VERIFY.toLocaleString()} drafts...\n`);
const sample = sampleScores(items, bosses, N_VERIFY, 20260820, config.draftSize);
const t = totals(sample, bosses, config.slope, config.difficulty);

const median = quantile(t, 0.5);
const p99 = quantile(t, 0.99);

check(
  'median 13-0 chance in 2-8%',
  median >= 0.02 && median <= 0.08 ? 'PASS' : 'FAIL',
  `${(median * 100).toFixed(2)}%`,
);
check('top 1% of drafts above 40%', p99 > 0.40 ? 'PASS' : 'FAIL', `${(p99 * 100).toFixed(2)}%`);

// ---- report -----------------------------------------------------------------
const mark = { PASS: '  ok  ', FAIL: ' FAIL ', PENDING: ' .... ', INFO: ' info ' };
for (const r of results) console.log(`[${mark[r.status]}] ${r.name}\n            ${r.detail}`);

const spread = [0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map((q) => `p${String(q * 100).padStart(2, '0')} ${(quantile(t, q) * 100).toFixed(2)}%`);
console.log(`\ndistribution: ${spread.join('  ')}`);

const failed = results.filter((r) => r.status === 'FAIL');
const pending = results.filter((r) => r.status === 'PENDING');
console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${failed.length} failed, ${pending.length} pending`);
process.exit(failed.length ? 1 : 0);
