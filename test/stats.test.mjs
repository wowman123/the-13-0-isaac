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
  const judas = characters.find((c) => c.name === 'Judas');
  const eve = characters.find((c) => c.name === 'Eve');

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
  assert.ok(pool.length > 350, `only ${pool.length} items are draftable in Advanced`);
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


test('the full roster is present and each entry composes', () => {
  const { characters } = load('data/characters.json');
  assert.ok(characters.length >= 20, `only ${characters.length} characters`);

  const ids = new Set();
  for (const c of characters) {
    assert.ok(c.id && c.name, 'a character is missing an id or a name');
    assert.ok(!ids.has(c.id), `${c.id}: duplicate id`);
    ids.add(c.id);

    const s = composeStats([], c.stats);
    for (const key of ['damage', 'fireRate', 'dps', 'effectiveHealth']) {
      assert.ok(Number.isFinite(s[key]) && s[key] >= 0, `${c.name}: ${key} is ${s[key]}`);
    }
    // A character with no health at all would divide the defense axis by zero.
    assert.ok(s.effectiveHealth > 0, `${c.name}: no health of any kind`);
  }
});

test("a character's own fire-rate multiplier is not ignored", () => {
  // Azazel fires at roughly a quarter of Isaac's rate. Reading tearsMult only
  // from items silently gave him Isaac's rate on top of Isaac's damage bonus.
  const characters = load('data/characters.json').characters;
  const isaac = composeStats([], characters.find((c) => c.name === 'Isaac').stats);
  const azazel = composeStats([], characters.find((c) => c.name === 'Azazel').stats);

  assert.ok(azazel.fireRate < isaac.fireRate * 0.5, `Azazel fires at ${azazel.fireRate.toFixed(2)}/s`);
  assert.ok(azazel.damage > isaac.damage, 'Azazel should still hit harder');
});

test('characters that do not fight with tears carry a caveat', () => {
  const { characters } = load('data/characters.json');
  for (const name of ['Azazel', 'Lilith', 'The Forgotten', 'Eden']) {
    const c = characters.find((x) => x.name === name);
    assert.ok(c, `${name} is missing from the roster`);
    assert.ok(c.caveat, `${name}: damage x fire rate does not describe them, and nothing says so`);
  }
});


test('the roster covers both rosters and every entry has health', () => {
  const { characters } = load('data/characters.json');
  const regular = characters.filter((c) => !c.tainted);
  const tainted = characters.filter((c) => c.tainted);

  assert.ok(regular.length >= 21, `only ${regular.length} regular characters`);
  assert.ok(tainted.length >= 19, `only ${tainted.length} tainted characters`);

  // Eden shipped with zero health because her column had no player id and the
  // lookup quietly returned an empty object. Nobody may have none.
  for (const c of characters) {
    const s = composeStats([], c.stats);
    assert.ok(s.effectiveHealth > 0, `${c.name}: no health of any kind`);
  }
});

test('health matches what players.xml says, not what a default filled in', () => {
  // A missing hp attribute means no red containers for most characters, and
  // means "rolled at the start of the run" only for Eden. Reading it either way
  // for everyone gets one of those two groups wrong.
  const { characters } = load('data/characters.json');
  const health = (name) => composeStats([], characters.find((c) => c.name === name).stats).effectiveHealth;

  assert.equal(health('Isaac'), 6);
  assert.equal(health('Dark Judas'), 4);        // no hp attribute, four black hearts
  assert.equal(health('The Soul'), 2);
  assert.equal(health('Tainted Judas'), 4);
  assert.equal(health('Tainted Soul'), 1);
  assert.equal(health('Tainted Bethany'), 12);
  assert.equal(health('Tainted Lost'), 1);
  assert.equal(health('Eden'), 6);              // randomised, so Isaac's stands in
});

test('the Forgotten pair splits its stats between its two halves', () => {
  // The wiki table marks these with a dash rather than a number, in different
  // columns in different rows. Reading a dash as zero would give the Soul no
  // damage at all and the Forgotten no speed.
  const { characters } = load('data/characters.json');
  const forgotten = characters.find((c) => c.name === 'Tainted Forgotten');
  const soul = characters.find((c) => c.name === 'Tainted Soul');

  assert.equal(forgotten.stats.speed, undefined, 'the body has no speed of its own');
  assert.ok(forgotten.stats.damageMult > 1, 'the body carries the damage');
  assert.equal(soul.stats.damageMult, undefined, 'the Soul has no tear damage');
  assert.ok(composeStats([], soul.stats).speed > 0, 'the Soul still moves');
});

test('tainted fire-rate penalties survive into the stat line', () => {
  const { characters } = load('data/characters.json');
  const rate = (name) => composeStats([], characters.find((c) => c.name === name).stats).fireRate;
  const isaac = rate('Isaac');

  assert.ok(rate('Tainted Azazel') < isaac * 0.4, 'Tainted Azazel fires at a third of the rate');
  assert.ok(rate('Tainted Eve') < isaac * 0.75, 'Tainted Eve fires at two thirds');
  assert.ok(rate('Tainted Keeper') < isaac * 0.5, 'Tainted Keeper is at -2.2 tears');
});


test('a hand rating counts in Advanced, and never counts twice', () => {
  const stats = load('data/item-stats.json').stats;
  const { items } = load('data/items.json');
  const rules = load('data/synergies.json').rules;
  const forms = load('data/transformations.json');
  const MECH = ['homing', 'laser', 'piercing', 'explosive', 'knife', 'orbital', 'familiar', 'dot', 'spectral', 'multishot', 'charged', 'flight'];

  // An item nothing else describes is still a considered judgement, so it is
  // used rather than the item being dropped from the pool.
  const handOnly = items.find(
    (i) => i.rated && !stats[i.id] && !(i.tags ?? []).some((t) => MECH.includes(t)),
  );
  assert.ok(handOnly, 'expected at least one hand-rated item with no other description');
  assert.ok(isAdvancedItem(handOnly, stats));

  const bare = composeAdvanced([], stats, rules, forms).build;
  const withIt = composeAdvanced([handOnly], stats, rules, forms).build;
  assert.notDeepEqual(bare, withIt, `${handOnly.name} changed nothing`);

  // An item with both a rating and a stat delta must be folded in once. Adding
  // it should move the build by its stats alone, not by stats times rating.
  const both = items.find((i) => i.rated && stats[i.id]);
  assert.ok(both, 'expected an item with both');
  const viaBoth = composeAdvanced([both], stats, rules, forms).build;
  const viaStatsOnly = composeAdvanced(
    [{ ...both, rated: null }], stats, rules, forms,
  ).build;
  assert.deepEqual(viaBoth, viaStatsOnly, `${both.name} is counted twice`);
});
