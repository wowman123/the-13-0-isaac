import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fightAt, endlessSummary, endlessShare, HEADSTART, picksAtDepth } from '../src/endless.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bosses = JSON.parse(readFileSync(join(root, 'data/bosses.json'), 'utf8'));

test('the first lap is the real ladder, untouched', () => {
  for (let i = 0; i < bosses.length; i++) {
    const f = fightAt(i, bosses);
    assert.equal(f.name, bosses[i].name);
    assert.equal(f.threshold, bosses[i].threshold);
    assert.equal(f.lap, 0);
  }
});

test('the ladder keeps climbing past the thirteenth and never flattens', () => {
  // A run that cannot end is not a game. Every fight must be harder than the
  // one thirteen back, forever.
  let previousLap = -1;
  for (let depth = 0; depth < bosses.length * 5; depth++) {
    const f = fightAt(depth, bosses);
    if (depth >= bosses.length) {
      const sameFightLastLap = fightAt(depth - bosses.length, bosses);
      assert.ok(
        f.threshold > sameFightLastLap.threshold,
        `depth ${depth}: ${f.threshold} is not above ${sameFightLastLap.threshold}`,
      );
    }
    assert.ok(f.lap >= previousLap);
    previousLap = f.lap;
  }
});

test('a later lap is marked so it cannot be mistaken for the first', () => {
  assert.equal(fightAt(0, bosses).label, bosses[0].name);
  assert.match(fightAt(bosses.length, bosses).label, /\+1$/);
  assert.match(fightAt(bosses.length * 2, bosses).label, /\+2$/);
});

test('the summary reports what was cleared and what ended it', () => {
  const fights = [
    { label: 'Basement I', chance: 0.92, cleared: true },
    { label: 'Basement II', chance: 0.31, cleared: true },
    { label: 'Caves I', chance: 0.64, cleared: false },
  ];
  const s = endlessSummary(fights);
  assert.equal(s.cleared, 2);
  assert.equal(s.died.label, 'Caves I');
  // The narrow escape is the more interesting number than the fight that won.
  assert.equal(s.luckiest.label, 'Basement II');
});

test('a run still going has no death to report', () => {
  const s = endlessSummary([{ label: 'Basement I', chance: 0.9, cleared: true }]);
  assert.equal(s.died, null);
  assert.equal(s.cleared, 1);
});

test('an empty run does not throw', () => {
  const s = endlessSummary([]);
  assert.equal(s.cleared, 0);
  assert.equal(s.died, null);
  assert.equal(s.luckiest, null);
});

test('the shared ladder is one block per fight and names nothing', () => {
  const fights = [
    { label: 'Basement I', chance: 0.92, cleared: true },
    { label: 'Basement II', chance: 0.31, cleared: true },
    { label: 'Caves I', chance: 0.64, cleared: false },
  ];
  const text = endlessShare(fights);
  const blocks = [...text].filter((c) => '🟩🟨🟧💀'.includes(c));
  assert.equal(blocks.length, 3);
  assert.match(text, /2 fights cleared/);
  assert.ok(!text.includes('Basement'), 'the share should not name the fights');
});


test('the ladder outruns a build that only ever grows', () => {
  // Every axis is capped but the composed score still climbs with the item
  // count, so a linearly rising ladder is one a good run never falls off —
  // half of them ran past two hundred fights before the climb accelerated.
  const rise = (lap) => fightAt(bosses.length * lap, bosses).threshold;
  const first = rise(1) - fightAt(0, bosses).threshold;
  const second = rise(2) - rise(1);
  const third = rise(3) - rise(2);
  assert.ok(second > first, 'lap two must rise more than lap one');
  assert.ok(third > second, 'and lap three more than lap two');
});

test('a run has a headstart, because the ladder expects five items', () => {
  // Meeting Basement I with a single item is not a hard opening, it is a
  // broken one: the difficulty was solved against five-item builds.
  assert.ok(HEADSTART >= 3);
  assert.equal(picksAtDepth(0), HEADSTART + 1);
  assert.equal(picksAtDepth(5), HEADSTART + 6);
});
