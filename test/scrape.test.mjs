import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseResources, parsePools, slug, normaliseId } from '../src/scrape-parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const itemsXml = readFileSync(join(here, 'fixtures/items.xml'), 'utf8');
const poolsXml = readFileSync(join(here, 'fixtures/itempools.xml'), 'utf8');

const HAND = ['COLLECTIBLE_SAD_ONION', 'COLLECTIBLE_BRIMSTONE', 'COLLECTIBLE_MOMS_KNIFE', 'COLLECTIBLE_WAFER', 'COLLECTIBLE_INCUBUS', 'COLLECTIBLE_ONE_UP'];

const run = (overrides) => parseResources(itemsXml, poolsXml, HAND, overrides);
const find = (r, id) => r.scraped.find((s) => s.id === id);

test('slug normalises punctuation and articles', () => {
  assert.equal(slug("Mom's Knife"), 'MOMS_KNIFE');
  assert.equal(slug('20/20'), '20_20');
  assert.equal(slug('Tech.5'), 'TECH_5');
  assert.equal(normaliseId('COLLECTIBLE_THE_INNER_EYE'), 'INNER_EYE');
});

test('trinkets are not collectibles and are skipped', () => {
  const r = run();
  assert.equal(r.scraped.length, 6);
  assert.ok(!r.scraped.some((s) => s.name === 'Gulp!'));
});

test('quality and type come off the element', () => {
  const r = run();
  assert.equal(find(r, 'COLLECTIBLE_BRIMSTONE').quality, 4);
  assert.equal(find(r, 'COLLECTIBLE_BRIMSTONE').type, 'passive');
  assert.equal(find(r, 'COLLECTIBLE_MOMS_KNIFE').type, 'active');
  assert.equal(find(r, 'COLLECTIBLE_INCUBUS').type, 'familiar');
});

test('pools are collected across every pool an item appears in', () => {
  const r = run();
  assert.deepEqual(find(r, 'COLLECTIBLE_BRIMSTONE').pools.sort(), ['devil', 'secret']);
  assert.deepEqual(find(r, 'COLLECTIBLE_SAD_ONION').pools, ['treasure']);
  assert.equal(parsePools(poolsXml).size, 6);
});

test('heart attributes are read in half-hearts', () => {
  const r = run();
  assert.equal(find(r, 'COLLECTIBLE_WAFER').stats.red_containers, 1);
  assert.equal(find(r, 'COLLECTIBLE_INCUBUS').stats.soul_hearts, 2);
  assert.equal(find(r, 'COLLECTIBLE_SAD_ONION').stats.red_containers, 0);
});

test('stat deltas the XML cannot supply stay null', () => {
  const stats = find(run(), 'COLLECTIBLE_BRIMSTONE').stats;
  for (const key of ['damage_flat', 'damage_mult', 'tears_flat', 'firerate_mult', 'shot_speed', 'range', 'speed', 'luck']) {
    assert.equal(stats[key], null, `${key} must not be invented`);
  }
  assert.deepEqual(stats.affects, ['damage']);
});

test('the leading article does not break matching', () => {
  const r = run();
  assert.ok(r.matched.includes('COLLECTIBLE_SAD_ONION'), '"The Sad Onion" should match COLLECTIBLE_SAD_ONION');
});

test('unmatched hand ids are reported, not dropped', () => {
  const r = run();
  assert.deepEqual(r.unmatched, ['COLLECTIBLE_ONE_UP']);
  assert.equal(r.matched.length, 5);
});

test('an override rescues a name that cannot be derived', () => {
  const r = run({ 'Totally New Item': 'COLLECTIBLE_ONE_UP' });
  assert.deepEqual(r.unmatched, []);
  assert.ok(find(r, 'COLLECTIBLE_ONE_UP'));
});
