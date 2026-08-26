import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AXIS_RANGE, resolveRating, fromTags } from '../src/ratings.js';
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

test('every hand-rated item has sprite art', () => {
  // A trinket or a card has no collectible sprite, so this doubles as a check
  // that nothing non-collectible has crept into the curated set. It applies to
  // the hand-rated core only; the auto-rated tail is imported wholesale from
  // the XML and is expected to outrun the art.
  const sprites = new Set(load('data/sprites.json').sprites);
  const artless = items.filter((i) => i.rated && !sprites.has(i.id)).map((i) => i.name);
  assert.deepEqual(artless, [], `no sprite for: ${artless.join(', ')}`);
});

test('every draftable item has a quality, since it is a roll axis', () => {
  // Scoped to items a roll can actually reach. items.xml also carries pickup
  // placeholders (PILLS_HERE, TAROT_CARD) that sit in no pool and have no
  // quality — they are not collectibles and can never be offered.
  const { scrapeLayer } = load('data/items.json');
  if (!scrapeLayer) return;
  const missing = items
    .filter((i) => (i.scraped?.pools ?? []).length && i.scraped?.quality == null)
    .map((i) => i.name);
  assert.deepEqual(missing, [], `${missing.length} draftable items without quality`);
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


test('every name override still matches something in the scrape', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const overrides = JSON.parse(readFileSync(join(here, '../data/name-overrides.json'), 'utf8'));
  const scraped = JSON.parse(readFileSync(join(here, '../data/scraped.json'), 'utf8')).items;
  const keys = new Set(scraped.map((s) => s.xmlName));
  for (const key of Object.keys(overrides)) {
    if (key.startsWith('_')) continue;
    assert.ok(keys.has(key), `${key} matches no item — a stale override is a lie about the data`);
  }
});

test('no draftable item still shows a raw localisation key or a lost apostrophe', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const { items } = JSON.parse(readFileSync(join(here, '../data/items.json'), 'utf8'));
  const known = new Set(['Glass Cannon', 'Glass Eye', 'Headless Baby', 'Jesus Juice', 'Mysterious Liquid', 'Sinus Infection']);
  for (const item of items) {
    if (item.scraped?.quality == null) continue;
    assert.ok(!item.name.includes('#'), `${item.id}: name is still a localisation key`);
    assert.ok(!/\s(Of|The|And|In|On|To|For|From)\s/.test(item.name), `${item.name}: small word capitalised mid-title`);
    // "Moms Key" is a possessive that lost its apostrophe; "Glass Eye" is not.
    if (/^[A-Z][a-z]+s\s/.test(item.name) && !known.has(item.name)) {
      assert.fail(`${item.name}: looks like a possessive missing its apostrophe`);
    }
  }
});


test('the stat tags read off `cache` actually reach the ratings', () => {
  // These come from the game's own cache attribute and were derived for the
  // synergy rules, but TAG_TABLE never listed them — so 414 of 693 draftable
  // items ignored everything known about them and fell through to quality
  // alone, which made every item in a Pool x Quality cell interchangeable.
  for (const tag of ['damage_up', 'tears_up', 'health_up', 'speed_up', 'range_up']) {
    assert.ok(fromTags([tag]), `${tag} is derived from the XML but rates nothing`);
  }

  const draftable = items.filter(
    (i) => i.scraped?.quality != null && (i.scraped?.pools ?? []).some((p) => !p.startsWith('greed')),
  );
  const qualityOnly = draftable.filter((i) => resolveRating(i).source === 'auto:quality').length;
  assert.ok(
    qualityOnly < draftable.length * 0.3,
    `${qualityOnly} of ${draftable.length} items rate on quality alone — the draft is a coin flip again`,
  );

  // The measure that matters: two items in the same offer should not be
  // numerically identical more often than not.
  const vector = (i) => AXES.map((a) => resolveRating(i)[a].toFixed(3)).join('/');
  const pools = [...new Set(draftable.flatMap((i) => i.scraped.pools.filter((p) => !p.startsWith('greed'))))];
  const spreads = [];
  for (const pool of pools) {
    for (let q = 0; q <= 4; q++) {
      const cell = draftable.filter((i) => i.scraped.quality === q && i.scraped.pools.includes(pool));
      if (cell.length > 1) spreads.push(new Set(cell.map(vector)).size / cell.length);
    }
  }
  const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  assert.ok(mean > 0.6, `only ${(mean * 100).toFixed(0)}% of a cell's items have distinct ratings`);
});
