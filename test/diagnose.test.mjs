import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diagnose, diagnosisText } from '../src/diagnose.js';
import { NEUTRAL, runOdds } from '../src/engine.js';
import { composeDraft } from '../src/synergy.js';
import { resolveRating } from '../src/ratings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const bosses = load('data/bosses.json');
const config = load('data/config.json');
const rules = load('data/synergies.json').rules;
const forms = load('data/transformations.json');
const { items } = load('data/items.json');

const run = (picks) => {
  const { build } = composeDraft(picks, picks.map(resolveRating), rules, forms);
  return { build, ...runOdds(build, bosses, config) };
};

test('the fight it names is the one that ends the most runs, not the least likely', () => {
  // A coin flip on the last fight costs fewer runs than a small risk taken
  // early, and the early one is the one worth knowing about.
  const pool = items.filter((i) => i.scraped?.quality != null);
  const { build, perBoss } = run(pool.slice(0, 5));
  const d = diagnose(build, perBoss, bosses);

  let alive = 1;
  const drops = perBoss.map((b) => { const before = alive; alive *= b.p; return before - alive; });
  const worstDrop = Math.max(...drops);
  assert.equal(d.ends.toFixed(6), worstDrop.toFixed(6));

  const leastLikely = Math.min(...perBoss.map((b) => b.p));
  assert.ok(d.clears >= leastLikely || d.fight, 'names a fight either way');
});

test('the axis it blames is one the killing fight actually weights', () => {
  const pool = items.filter((i) => i.scraped?.quality != null);
  for (const start of [0, 120, 300, 480]) {
    const { build, perBoss } = run(pool.slice(start, start + 5));
    const d = diagnose(build, perBoss, bosses);
    const boss = bosses.find((b) => b.name === d.fight);
    assert.ok(boss, `${d.fight} is not a real fight`);
    assert.ok((boss.weights[d.axis] ?? 0) > 0, `${d.fight} does not weight ${d.axis} at all`);
  }
});

test('a build with nothing especially weak is told so rather than blamed', () => {
  // A build that is even across the board has no thin axis, and inventing a
  // culprit would be worse than saying it is simply small. NEUTRAL is the only
  // genuinely even build: five neutral *items* are not, because conflicts fire
  // between them and pull offense down, which the diagnosis correctly blames.
  const { perBoss } = runOdds({ ...NEUTRAL }, bosses, config);
  const d = diagnose({ ...NEUTRAL }, perBoss, bosses);
  assert.equal(d.meaningful, false);
  assert.match(diagnosisText(d), /not big enough/);
});

test('a build thin on one axis has that axis blamed', () => {
  const even = { offense: 2, aoe: 2, defense: 2, tracking: 0.9, evasion: 0.5 };
  const thin = { ...even, tracking: 0 };
  const d = diagnose(thin, runOdds(thin, bosses, config).perBoss, bosses);
  assert.equal(d.meaningful, true);
  const boss = bosses.find((b) => b.name === d.fight);
  assert.ok((boss.weights[d.axis] ?? 0) > 0);
});

test('it says nothing at all rather than something wrong', () => {
  assert.equal(diagnose({ ...NEUTRAL }, [], bosses), null);
  assert.equal(diagnosisText(null), null);
});

test('the sentence names a fight and a real number of runs', () => {
  const pool = items.filter((i) => i.scraped?.quality != null);
  const { build, perBoss } = run(pool.slice(60, 65));
  const text = diagnosisText(diagnose(build, perBoss, bosses));
  assert.match(text, /of every 100 runs end at /);
  assert.ok(!text.includes('undefined'));
  assert.ok(!text.includes('NaN'));
});
