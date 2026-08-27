import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CHAOS_ID,
  ALL_POOLS,
  activeRules,
  inPool,
  qualities,
  ruleItemIds,
} from '../src/rule-items.js';
import { buildDaily, DEFAULT_RULE_SPEC } from '../src/daily.js';
import { POOL_LABELS, poolLabel } from '../src/pools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const { items } = read('data/items.json');
const spec = read('data/rule-items.json');
const text = read('data/item-stats.json').text;
const isRealPool = (p) => !p.startsWith('greed');
const byId = (id) => items.find((i) => i.id === id);
const held = (...ids) => activeRules(ids.map(byId), spec);

test('every rule item is a real item a run could actually reach', () => {
  // The whole mechanic hangs on these ids, so a rename upstream must fail here
  // rather than silently turning the items back into ordinary picks.
  assert.ok(spec.items.length >= 6, 'the rule list lost entries');
  for (const rule of spec.items) {
    const item = byId(rule.id);
    assert.ok(item, `${rule.id} is not in the item data`);
    assert.ok(
      (item.scraped?.pools ?? []).some(isRealPool),
      `a run cannot reach ${rule.id}`,
    );
    assert.ok(rule.effect, `${rule.id} changes no rule`);
  }
});

test('what a rule item says it does is what the game says it does', () => {
  // `says` is quoted, not written. If the quote and the source ever disagree
  // the page is telling players something the item does not do.
  for (const rule of spec.items) {
    assert.ok(
      (text[rule.id] ?? '').startsWith(rule.says),
      `${rule.id}: "${rule.says}" is not what the item data says`,
    );
  }
});

test('holding an item is what turns its rule on, and nothing else does', () => {
  const other = items.find((i) => !ruleItemIds(spec).has(i.id) && i.scraped?.quality != null);
  assert.equal(activeRules([], spec).combinePools, false);
  assert.equal(activeRules([other, other], spec).combinePools, false);
  assert.equal(held(CHAOS_ID).combinePools, true);
  assert.equal(held(CHAOS_ID).active.length, 1);
});

test('Sacred Orb raises the floor of the draft', () => {
  assert.deepEqual(qualities(activeRules([], spec)), [0, 1, 2, 3, 4]);
  assert.deepEqual(qualities(held('COLLECTIBLE_SACRED_ORB')), [2, 3, 4]);
});

test('the pedestal items add up, as they do in the game', () => {
  assert.equal(held('COLLECTIBLE_MORE_OPTIONS').extraRolls, 2);
  assert.equal(held('COLLECTIBLE_THERES_OPTIONS').extraRolls, 1);
  assert.equal(held('COLLECTIBLE_MORE_OPTIONS', 'COLLECTIBLE_THERES_OPTIONS').extraRolls, 3);
});

test('the D6 hands out redraws and Death Certificate a single wildcard', () => {
  assert.equal(held('COLLECTIBLE_D6').offerRerolls, 1);
  assert.equal(held('COLLECTIBLE_DEATH_CERTIFICATE').wildcards, 1);
  const all = held(...spec.items.map((r) => r.id));
  assert.deepEqual(
    {
      combinePools: all.combinePools,
      minQuality: all.minQuality,
      extraRolls: all.extraRolls,
      offerRerolls: all.offerRerolls,
      wildcards: all.wildcards,
    },
    { combinePools: true, minQuality: 2, extraRolls: 3, offerRerolls: 1, wildcards: 1 },
  );
});

test('a collapsed roll reaches every item a run could reach, and no more', () => {
  const treasureOnly = items.find(
    (i) => (i.scraped?.pools ?? []).filter(isRealPool).join() === 'treasure',
  );
  assert.ok(treasureOnly, 'expected an item that only appears in the Treasure Room');

  // Out of reach on a Shop roll, in reach once the pools are gone.
  assert.equal(inPool(treasureOnly, 'shop', isRealPool), false);
  assert.equal(inPool(treasureOnly, ALL_POOLS, isRealPool), true);

  // Greed mode is a different game and stays out even with the pools combined.
  const greedOnly = items.find(
    (i) => (i.scraped?.pools ?? []).length && !(i.scraped.pools).some(isRealPool),
  );
  if (greedOnly) assert.equal(inPool(greedOnly, ALL_POOLS, isRealPool), false);
});

test('collapsing the pools widens what a quality can offer', () => {
  const atQuality = (q, pool) => items.filter(
    (i) => i.scraped?.quality === q && inPool(i, pool, isRealPool),
  ).length;
  for (let q = 0; q <= 4; q++) {
    assert.ok(
      atQuality(q, ALL_POOLS) > atQuality(q, 'shop'),
      `quality ${q} did not widen`,
    );
  }
});

test('the daily carries the same rule list the page does', () => {
  // daily.js keeps a literal copy because it cannot read a file in the browser.
  assert.deepEqual(
    DEFAULT_RULE_SPEC.items.map((r) => r.id).sort(),
    spec.items.map((r) => r.id).sort(),
  );
});

test('a daily never offers a rule item, because it could not honour one', () => {
  // Every round of a daily is dealt before the first pick, so an item whose
  // whole effect is on later rolls has no effect there at all.
  const ids = ruleItemIds(spec);
  for (let d = 0; d < 120; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    for (const round of buildDaily(items, day).rounds) {
      for (const id of round.candidates) {
        assert.ok(!ids.has(id), `${day} offered ${id}`);
      }
    }
  }
});

test('taking the rule items out does not starve any daily round', () => {
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const { rounds } = buildDaily(items, day);
    assert.equal(rounds.length, 5);
    for (const r of rounds) assert.ok(r.candidates.length >= 4);
  }
});

test('every pool the item data uses has a name on screen', () => {
  // A pool with no name here used to fall back to a title-cased id, which is
  // how "Woodenchest" reached the page. The next pool the data gains fails here.
  const used = new Set(items.flatMap((i) => i.scraped?.pools ?? []).filter(isRealPool));
  for (const pool of used) {
    assert.ok(POOL_LABELS[pool], `the ${pool} pool has no name`);
  }
  assert.equal(poolLabel(ALL_POOLS, ALL_POOLS), 'All pools');
});
