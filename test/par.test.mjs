import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parForDeal, parScore, parGrade } from '../src/par.js';
import { recordDay, currentStreak, bestStreak, previousDay, summary, distribution } from '../src/streak.js';
import { buildDaily } from '../src/daily.js';
import { resolveRating } from '../src/ratings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const { items } = load('data/items.json');
const bosses = load('data/bosses.json');
const config = load('data/config.json');
const rules = load('data/synergies.json').rules;
const forms = load('data/transformations.json');
const byId = new Map(items.map((i) => [i.id, i]));

const parFor = (day) => {
  const { rounds } = buildDaily(items, day);
  return parForDeal(rounds, (id) => byId.get(id), resolveRating, bosses, config, rules, forms);
};

test('a deal is small enough to solve exactly', () => {
  // The whole feature rests on this: a daily fixes all five offers up front,
  // so its tree is a few thousand builds rather than the whole item pool deep.
  const par = parFor('2026-08-27');
  assert.ok(par.count > 100 && par.count <= 6 ** 5, `${par.count} builds`);
  assert.equal(par.best.picks.length, 5);
  assert.ok(par.best.total > par.worst.total);
});

test('the best it found really is the best in the deal', () => {
  const par = parFor('2026-08-27');
  assert.equal(par.totals.length, par.count);
  assert.equal(Math.max(...par.totals).toFixed(9), par.best.total.toFixed(9));
  assert.equal(Math.min(...par.totals).toFixed(9), par.worst.total.toFixed(9));
});

test('the percentile puts the floor at nothing and the ceiling at everything', () => {
  const par = parFor('2026-08-27');
  assert.equal(parScore(par.worst.total, par.totals), 0);
  assert.ok(parScore(par.best.total, par.totals) > 0.999);
});

test('a percentile is used because interpolating flattered everybody', () => {
  // The worst build in a deal is often a thousandth of a percent, so anchoring
  // to it made a poor score read as respectable. The percentile answers the
  // question directly instead.
  const par = parFor('2026-08-27');
  const median = par.totals[Math.floor(par.count / 2)];
  const f = parScore(median, par.totals);
  assert.ok(f > 0.45 && f < 0.55, `the median build scored ${(f * 100).toFixed(0)}%`);
});

test('only an exact best earns the top grade', () => {
  assert.equal(parGrade(1, true), 'the best build the deal allowed');
  assert.notEqual(parGrade(0.9999, false), 'the best build the deal allowed');
});

test('a streak counts consecutive days and survives an unplayed today', () => {
  let h = {};
  for (const d of ['2026-08-25', '2026-08-26', '2026-08-27']) h = recordDay(h, d, { par: 0.5 });

  assert.equal(currentStreak(h, '2026-08-27'), 3);
  // Waking up before you have played must not end it.
  assert.equal(currentStreak(h, '2026-08-28'), 3);
  // Missing a whole day does.
  assert.equal(currentStreak(h, '2026-08-29'), 0);
});

test('day arithmetic crosses month and year boundaries', () => {
  assert.equal(previousDay('2026-09-01'), '2026-08-31');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
});

test('replaying a day cannot inflate anything', () => {
  let h = recordDay({}, '2026-08-27', { par: 0.2 });
  h = recordDay(h, '2026-08-27', { par: 0.9 });
  assert.equal(Object.keys(h).length, 1);
  assert.equal(currentStreak(h, '2026-08-27'), 1);
});

test('the best streak is found anywhere in the history', () => {
  let h = {};
  for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-20']) {
    h = recordDay(h, d, { par: 0.5 });
  }
  assert.equal(bestStreak(h), 4);
  assert.equal(currentStreak(h, '2026-08-20'), 1);
});

test('history is bucketed by percentile, not by raw score', () => {
  // Raw scores are not comparable between days: 12% on a deal that allowed 13%
  // is a better day's work than 30% on one that allowed 60%.
  let h = {};
  h = recordDay(h, '2026-08-25', { par: 0.95, total: 0.12 });
  h = recordDay(h, '2026-08-26', { par: 0.2, total: 0.30 });
  const d = distribution(h);
  assert.equal(d.find((b) => b.label === 'Top 10%').count, 1);
  assert.equal(d.find((b) => b.label === '15–40%').count, 1);
});

test('an empty history summarises without throwing', () => {
  const s = summary({}, '2026-08-27');
  assert.equal(s.played, 0);
  assert.equal(s.streak, 0);
  assert.equal(s.bestPar, null);
});
