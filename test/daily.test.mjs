import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDaily, seedForDay, shareText, DAILY_ROUNDS } from '../src/daily.js';
import { dayKey, hashString, mulberry32 } from '../src/random.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { items } = JSON.parse(readFileSync(join(root, 'data/items.json'), 'utf8'));

test('a day deals the same puzzle every time it is asked', () => {
  // There is no server to hand a puzzle out, so this property is the entire
  // reason two people can compare their scores at all.
  const a = buildDaily(items, '2026-08-27');
  const b = buildDaily(items, '2026-08-27');
  assert.deepEqual(a, b);
});

test('different days deal different puzzles', () => {
  const days = ['2026-08-27', '2026-08-28', '2026-08-29', '2026-09-01'];
  const seen = new Set(days.map((d) => JSON.stringify(buildDaily(items, d).rounds)));
  assert.equal(seen.size, days.length);
});

test('a day is five rounds, and no item is offered twice', () => {
  for (const day of ['2026-01-01', '2026-06-15', '2026-12-31']) {
    const { rounds } = buildDaily(items, day);
    assert.equal(rounds.length, DAILY_ROUNDS, `${day}: ${rounds.length} rounds`);

    const offered = rounds.flatMap((r) => r.candidates);
    assert.equal(new Set(offered).size, offered.length, `${day}: an item is offered twice`);
  }
});

test('every daily round is an actual decision', () => {
  // Free play rolling a one-item cell is texture. As a fifth of a fixed puzzle
  // everyone is measured on, it is a round nobody gets to play.
  for (let d = 0; d < 120; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    for (const round of buildDaily(items, day).rounds) {
      assert.ok(round.candidates.length >= 4, `${day}: a round offered ${round.candidates.length}`);
    }
  }
});

test('every offered item really sits where the roll says it does', () => {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const day of ['2026-03-03', '2026-07-07']) {
    for (const round of buildDaily(items, day).rounds) {
      for (const id of round.candidates) {
        const item = byId.get(id);
        assert.ok(item, `${id} is not in the pool`);
        assert.equal(item.scraped.quality, round.quality);
        assert.ok(item.scraped.pools.includes(round.pool));
      }
    }
  }
});

test('the day key is UTC, so two players compare the same puzzle', () => {
  // Local dates would put Auckland and Los Angeles on different puzzles for
  // most of the hours they overlap.
  assert.equal(dayKey(new Date('2026-08-27T23:59:59Z')), '2026-08-27');
  assert.equal(dayKey(new Date('2026-08-28T00:00:01Z')), '2026-08-28');
});

test('the shared result names nothing that would spoil the puzzle', () => {
  const text = shareText('2026-08-27', [3, 4, 2, 4, 1], 0.2437, 'https://example.test/');
  assert.match(text, /2026-08-27/);
  assert.match(text, /24\.4%/);
  // Five blocks, one per pick, and no item names anywhere.
  const blocks = [...text].filter((c) => '⬜🟦🟩🟨🟥'.includes(c));
  assert.equal(blocks.length, 5);
  for (const item of items.slice(0, 200)) {
    assert.ok(!text.includes(item.name), `share text leaks ${item.name}`);
  }
});

test('the seed depends on the day and nothing else', () => {
  assert.equal(seedForDay('2026-08-27'), seedForDay('2026-08-27'));
  assert.notEqual(seedForDay('2026-08-27'), seedForDay('2026-08-28'));
  assert.equal(typeof seedForDay('2026-08-27'), 'number');
});

test('the shared generator is the one the tools use', () => {
  // sim.mjs re-exports this rather than keeping its own copy, so a daily dealt
  // in the browser and one dealt by a tool cannot drift apart.
  const a = mulberry32(hashString('the-13-0:2026-08-27'));
  const b = mulberry32(hashString('the-13-0:2026-08-27'));
  assert.equal(a(), b());
});
