import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BASE, SPEED_CAP, damageFrom, tearDelay, fireRate, composeStats, statsToAxes, baselineStats,
} from '../src/stats.js';
import { isAdvancedItem, composeAdvanced } from '../src/advanced.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const close = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

// These are the checks that say the formulas are the game's and not merely
// plausible: each expected value is one the game or its documentation states.
test('Isaac holding nothing matches his character sheet', () => {
  const s = composeStats([]);
  close(s.damage, 3.5);
  assert.equal(s.tearDelay, 10);
  close(s.fireRate, 2.73, 0.01);
});

test('the damage curve reproduces the documented worked example', () => {
  // One Pentagram: 3.5 x sqrt(1 x 1.2 + 1) = 5.19. A second gives 6.45, not
  // 6.88 — which is the whole point of the square root.
  close(damageFrom(1), 5.19, 0.01);
  close(damageFrom(2), 6.45, 0.01);
  assert.ok(damageFrom(2) - damageFrom(1) < damageFrom(1) - damageFrom(0));
});

test('tear delay follows the curve and stops at the floor', () => {
  assert.equal(tearDelay(0), 10);
  assert.equal(tearDelay(0.7), 7);
  // Past a point more tear ups buy nothing; the game clamps at five frames.
  assert.equal(tearDelay(50), 5);
  assert.ok(fireRate(50) > fireRate(0));
});

test('a fire-rate multiplier scales the rate, not the stat behind it', () => {
  const plain = composeStats([{ tears: 1 }]);
  const halved = composeStats([{ tears: 1, tears_x: 0.5 }]);
  close(halved.fireRate, plain.fireRate * 0.5);
  // The delay is unchanged, because the multiplier lands after the curve.
  assert.equal(halved.tearDelay, plain.tearDelay);
});

test('DPS is damage times rate, so fire rate is not cosmetic', () => {
  const s = composeStats([{ dmg: 1 }, { tears: 1 }]);
  close(s.dps, s.damage * s.fireRate);
});

test('speed is capped where the game caps it', () => {
  const s = composeStats([{ speed: 5 }]);
  assert.equal(s.speed, SPEED_CAP);
});

test('every character is measured against Isaac, not against themselves', () => {
  const characters = load('data/characters.json').characters;
  const judas = characters.find((c) => c.id === 'JUDAS');
  const eve = characters.find((c) => c.id === 'EVE');

  // Judas' 1.35x has to show up as an advantage. Measuring him against his own
  // baseline would cancel it out and make the choice of character worthless.
  assert.ok(statsToAxes(composeStats([], judas.stats)).offense > 1);
  assert.ok(statsToAxes(composeStats([], eve.stats)).offense < 1);
  // He pays for it in health.
  assert.ok(statsToAxes(composeStats([], judas.stats)).defense < 1);
});

test('a bare build sits exactly on the baseline', () => {
  const axes = statsToAxes(composeStats([]), baselineStats());
  close(axes.offense, 1);
  close(axes.defense, 1);
  close(axes.evasion, 0);
});

test('Advanced offers only items it can say something about', () => {
  const stats = load('data/item-stats.json').stats;
  const { items } = load('data/items.json');

  const mechanicOnly = { id: 'X', tags: ['homing'] };
  const statOnly = { id: Object.keys(stats)[0], tags: [] };
  const neither = { id: 'NOPE', tags: ['offensive', 'summonable'] };

  assert.ok(isAdvancedItem(mechanicOnly, stats));
  assert.ok(isAdvancedItem(statOnly, stats));
  assert.ok(!isAdvancedItem(neither, stats));

  // The restricted pool still has to be big enough to draft from.
  const pool = items.filter(
    (i) => i.scraped?.quality != null
      && (i.scraped?.pools ?? []).some((p) => !p.startsWith('greed'))
      && isAdvancedItem(i, stats),
  );
  assert.ok(pool.length > 250, `only ${pool.length} items are draftable in Advanced`);
});

test('Advanced composition stays inside the axis ranges', () => {
  const stats = load('data/item-stats.json').stats;
  const { items } = load('data/items.json');
  const rules = load('data/synergies.json').rules;
  const forms = load('data/transformations.json');
  // Build-level ceilings, not the per-item ranges: a finished build may go
  // further than any single item is allowed to on its own.
  const ranges = { offense: [0, 4.5], aoe: [0, 4.5], tracking: [0, 1], defense: [0, 4.0], evasion: [0, 1] };

  const pool = items.filter((i) => i.scraped?.quality != null && isAdvancedItem(i, stats));
  for (let i = 0; i + 5 <= pool.length; i += 37) {
    const { build } = composeAdvanced(pool.slice(i, i + 5), stats, rules, forms);
    for (const [axis, [lo, hi]] of Object.entries(ranges)) {
      assert.ok(build[axis] >= lo && build[axis] <= hi, `${axis} ${build[axis]} outside ${lo}-${hi}`);
    }
  }
});

test('both modes carry their own solved difficulty', () => {
  const config = load('data/config.json');
  assert.ok(config.advanced, 'no advanced calibration in data/config.json');
  for (const key of ['slope', 'difficulty']) {
    assert.equal(typeof config.advanced[key], 'number');
  }
  // Solving one against the other's distribution would put a mode off target.
  assert.notEqual(config.advanced.difficulty, config.difficulty);
});
