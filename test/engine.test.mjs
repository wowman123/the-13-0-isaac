import test from 'node:test';
import assert from 'node:assert/strict';
import { softCap, union, composeBuild, toScoreSpace, bossOdds, NEUTRAL } from '../src/engine.js';
import { resolveRating, fromTags, fromQuality } from '../src/ratings.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);
const item = (over) => ({ ...NEUTRAL, ...over });

test('softCap is identity below the knee', () => {
  close(softCap(1.0), 1.0);
  close(softCap(3.5), 3.5);
});

test('softCap gives 40% credit past the knee', () => {
  close(softCap(4.5), 3.5 + 0.4 * 1.0);
  close(softCap(10), 3.5 + 0.4 * 6.5);
});

test('offense and aoe multiply then soft-cap', () => {
  const build = composeBuild(Array(5).fill(item({ offense: 1.5, aoe: 1.2 })));
  close(build.offense, softCap(1.5 ** 5));
  close(build.aoe, softCap(1.2 ** 5));
});

test('two Q4 damage items cannot produce an auto-win', () => {
  const build = composeBuild([item({ offense: 2.4 }), item({ offense: 2.3 })]);
  assert.ok(build.offense < 2.4 * 2.3, 'soft cap must bite');
  close(build.offense, softCap(2.4 * 2.3));
});

test('defense multiplies and hard-caps at 4.0', () => {
  close(composeBuild([item({ defense: 1.5 }), item({ defense: 2.0 })]).defense, 3.0);
  close(composeBuild(Array(5).fill(item({ defense: 2.5 }))).defense, 4.0);
});

test('tracking takes the max — homing does not stack', () => {
  const build = composeBuild([item({ tracking: 0.9 }), item({ tracking: 0.9 }), item({ tracking: 0.3 })]);
  close(build.tracking, 0.9);
});

test('evasion combines with diminishing returns', () => {
  close(union([0.35, 0.35]), 1 - 0.65 * 0.65);
  close(composeBuild([item({ evasion: 0.5 }), item({ evasion: 0.5 })]).evasion, 0.75);
});

test('an all-neutral draft composes to the neutral vector', () => {
  const build = composeBuild(Array(5).fill({ ...NEUTRAL }));
  assert.deepEqual(build, { offense: 1, aoe: 1, defense: 1, tracking: 0, evasion: 0 });
});

test('score space puts a neutral build at the origin', () => {
  const s = toScoreSpace(composeBuild(Array(5).fill({ ...NEUTRAL })));
  for (const v of Object.values(s)) close(v, 0);
});

test('the empty draft is neutral, not NaN', () => {
  assert.deepEqual(composeBuild([]), { ...NEUTRAL });
});

test('tag table: laser + piercing + charged', () => {
  const r = fromTags(['laser', 'piercing', 'charged']);
  close(r.offense, 1.15);
  close(r.aoe, 1.3 * 1.4);
  close(r.tracking, 0.3 * 0.6); // laser floor, then the charged penalty
});

test('tag table: tracking floors do not stack with each other', () => {
  close(fromTags(['homing', 'familiar']).tracking, 0.9);
});

test('tag table: explosive carries its self-damage penalty', () => {
  close(fromTags(['explosive']).defense, 0.9);
});

test('tag table: flight contributes evasion only', () => {
  const r = fromTags(['flight']);
  close(r.evasion, 0.35);
  close(r.offense, 1.0);
});

test('unknown tags alone fall through to quality', () => {
  assert.equal(fromTags(['not_a_real_tag']), null);
  close(fromQuality(4).offense, 1.6);
  close(resolveRating({ tags: ['not_a_real_tag'], scraped: { quality: 3 } }).offense, 1.35);
});

test('resolveRating prefers the hand layer', () => {
  const r = resolveRating({ tags: ['laser'], rated: { ...NEUTRAL, offense: 2.4, source: 'hand' } });
  assert.equal(r.source, 'hand');
  close(r.offense, 2.4);
});

test('resolveRating clamps a hand rating into its legal range', () => {
  const r = resolveRating({ rated: { ...NEUTRAL, offense: 99, defense: 0.1, source: 'hand' } });
  close(r.offense, 3.0);
  close(r.defense, 0.8);
});

test('resolveRating never returns undefined axes', () => {
  const r = resolveRating({ id: 'X' });
  for (const axis of ['offense', 'aoe', 'tracking', 'defense', 'evasion']) {
    assert.ok(Number.isFinite(r[axis]), `${axis} is ${r[axis]}`);
  }
});

test('odds rise monotonically with offense against an offense-weighted boss', () => {
  const boss = { threshold: 0, weights: { offense: 3, aoe: 0, tracking: 0, defense: 0, evasion: 0 } };
  const cfg = { slope: 1, difficulty: 0 };
  const weak = bossOdds(composeBuild([item({ offense: 1.0 })]), boss, cfg);
  const strong = bossOdds(composeBuild([item({ offense: 2.0 })]), boss, cfg);
  assert.ok(strong > weak, `${strong} should beat ${weak}`);
});

test('a boss ignores axes it puts no weight on', () => {
  const boss = { threshold: 0, weights: { offense: 3 } };
  const cfg = { slope: 1, difficulty: 0 };
  const a = bossOdds(composeBuild([item({ offense: 1.5, defense: 1.0 })]), boss, cfg);
  const b = bossOdds(composeBuild([item({ offense: 1.5, defense: 2.5 })]), boss, cfg);
  close(a, b);
});
