import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AXIS_RANGE, resolveRating } from '../src/ratings.js';
import { AXES } from '../src/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const { items } = load('data/items.json');
const bosses = load('data/bosses.json');
const config = load('data/config.json');

test('items.json is populated', () => {
  assert.ok(items.length > 100, `only ${items.length} items`);
});

test('every item has a unique id and a name', () => {
  const seen = new Set();
  for (const i of items) {
    assert.match(i.id, /^COLLECTIBLE_[A-Z0-9_]+$/, `bad id ${i.id}`);
    assert.ok(i.name?.length, `${i.id} has no name`);
    assert.ok(!seen.has(i.id), `duplicate ${i.id}`);
    seen.add(i.id);
  }
});

test('every rated axis is inside its legal range', () => {
  for (const i of items) {
    if (!i.rated) continue;
    for (const axis of AXES) {
      const [lo, hi] = AXIS_RANGE[axis];
      const v = i.rated[axis];
      assert.ok(v >= lo && v <= hi, `${i.id}.${axis} = ${v}, expected ${lo}-${hi}`);
    }
  }
});

test('every item resolves to a finite rating vector', () => {
  for (const i of items) {
    const r = resolveRating(i);
    for (const axis of AXES) assert.ok(Number.isFinite(r[axis]), `${i.id}.${axis}`);
  }
});

test('scraped stays null until the scrape layer is generated', () => {
  const { scrapeLayer } = load('data/items.json');
  if (scrapeLayer) return;
  for (const i of items) {
    assert.equal(i.scraped, null, `${i.id} has scraped data without a scrape layer`);
  }
});

test('every item has sprite art', () => {
  // A trinket or a card has no collectible sprite, so this doubles as a check
  // that nothing non-collectible has crept into the dataset.
  const sprites = new Set(load('data/sprites.json').sprites);
  const artless = items.filter((i) => !sprites.has(i.id)).map((i) => i.name);
  assert.deepEqual(artless, [], `no sprite for: ${artless.join(', ')}`);
});

test('the ladder is 13 fights, indexed 1..13', () => {
  assert.equal(bosses.length, 13);
  assert.deepEqual(bosses.map((b) => b.index), Array.from({ length: 13 }, (_, i) => i + 1));
});

test('Delirium leans on tracking and the Beast leans on aoe', () => {
  const deli = bosses.find((b) => b.id === 'BOSS_DELIRIUM');
  const beast = bosses.find((b) => b.id === 'BOSS_THE_BEAST');
  assert.ok(deli.weights.tracking > deli.weights.aoe, 'Delirium should care about tracking over aoe');
  assert.ok(beast.weights.aoe > beast.weights.offense, 'The Beast should care about aoe over single-target');
  assert.ok(beast.weights.evasion > deli.weights.evasion, 'The Beast should reward mobility more');
});

test('every boss weights every axis it is given, with no strays', () => {
  for (const b of bosses) {
    for (const axis of Object.keys(b.weights)) assert.ok(AXES.includes(axis), `${b.id} has stray axis ${axis}`);
    for (const axis of AXES) assert.ok(Number.isFinite(b.weights[axis]), `${b.id} missing ${axis}`);
  }
});

test('difficulty ramps monotonically up the ladder', () => {
  for (let i = 1; i < bosses.length; i++) {
    assert.ok(bosses[i].threshold > bosses[i - 1].threshold, `${bosses[i].id} is not harder than the fight before it`);
  }
});

test('config carries solved parameters', () => {
  assert.ok(Number.isFinite(config.slope) && config.slope > 0);
  assert.ok(Number.isFinite(config.difficulty));
  assert.equal(config.draftSize, 5);
});
