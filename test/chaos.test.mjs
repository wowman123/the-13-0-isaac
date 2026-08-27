import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHAOS_ID, ALL_POOLS, poolsCollapsed, inPool } from '../src/chaos.js';
import { buildDaily } from '../src/daily.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { items } = JSON.parse(readFileSync(join(root, 'data/items.json'), 'utf8'));
const isRealPool = (p) => !p.startsWith('greed');

test('Chaos is a real item in the pool, and the rule points at it', () => {
  // The whole mechanic hangs on this id, so a rename upstream must fail here
  // rather than silently turning the item back into an ordinary pick.
  const chaos = items.find((i) => i.id === CHAOS_ID);
  assert.ok(chaos, 'Chaos is not in the item data');
  assert.equal(chaos.name, 'Chaos');
  assert.ok((chaos.scraped?.pools ?? []).some(isRealPool), 'a run cannot reach Chaos');
});

test('holding Chaos is what collapses the pools, and nothing else does', () => {
  const chaos = items.find((i) => i.id === CHAOS_ID);
  const other = items.find((i) => i.id !== CHAOS_ID && i.scraped?.quality != null);
  assert.equal(poolsCollapsed([other, other]), false);
  assert.equal(poolsCollapsed([other, chaos]), true);
  assert.equal(poolsCollapsed([]), false);
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

test('a daily never offers Chaos, because it could not honour it', () => {
  // Every round of a daily is dealt before the first pick, so an item whose
  // whole effect is on later rolls has no effect there at all.
  for (let d = 0; d < 120; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    for (const round of buildDaily(items, day).rounds) {
      assert.ok(!round.candidates.includes(CHAOS_ID), `${day} offered Chaos`);
    }
  }
});

test('taking Chaos out does not starve any daily round', () => {
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const { rounds } = buildDaily(items, day);
    assert.equal(rounds.length, 5);
    for (const r of rounds) assert.ok(r.candidates.length >= 4);
  }
});
