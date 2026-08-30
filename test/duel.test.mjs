import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { duel, duelSummary, duelShare, encodeBuild, decodeBuild, newSeed } from '../src/duel.js';
import { buildDeal, buildDaily, DAILY_ROUNDS } from '../src/daily.js';
import { bossOdds } from '../src/engine.js';
import { composeDraft } from '../src/synergy.js';
import { resolveRating } from '../src/ratings.js';
import { mulberry32 } from '../src/random.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const { items } = read('data/items.json');
const bosses = read('data/bosses.json');
const config = read('data/config.json');
const rules = read('data/synergies.json').rules;
const transformations = read('data/transformations.json');

const byId = new Map(items.map((i) => [i.id, i]));
const ratings = new Map(items.map((i) => [i.id, resolveRating(i)]));
const pool = items.filter((i) => i.scraped?.quality != null);

const oddsAt = (ids, fight, cfg) => {
  const its = ids.map((id) => byId.get(id));
  const { build } = composeDraft(its, ids.map((id) => ratings.get(id)), rules, transformations);
  return bossOdds(build, fight, cfg);
};

const buildFrom = (start) => pool.slice(start, start + 5).map((i) => i.id);
const A = buildFrom(0);
const B = buildFrom(60);

test('a duel is a pure function of the two builds and the seed', () => {
  // Nothing is rolled on one screen and reported to the other — both players
  // derive the same fights from the same three strings, which is the only
  // reason a link can carry a finished duel with no server behind it.
  const one = duel(A, B, bosses, config, 'seedone', oddsAt);
  const two = duel(A, B, bosses, config, 'seedone', oddsAt);
  assert.deepEqual(one, two);

  const other = duel(A, B, bosses, config, 'seedtwo', oddsAt);
  assert.notDeepEqual(one.rounds, other.rounds);
});

test('a duel always ends, and ends the moment somebody falls', () => {
  for (let i = 0; i < 40; i++) {
    const r = duel(buildFrom(i * 3), buildFrom(200 + i * 3), bosses, config, `s${i}`, oddsAt);
    assert.ok(r.ended, 'the ladder let a duel run forever');
    assert.ok(!r.capped, 'a duel hit the safety cap');

    // Everything before the last fight was cleared by both, and the last was
    // not cleared by at least one. That is what "until one of them falls" is.
    for (const round of r.rounds.slice(0, -1)) {
      assert.ok(round.a.cleared && round.b.cleared);
    }
    const last = r.rounds.at(-1);
    assert.ok(!last.a.cleared || !last.b.cleared);
    assert.equal(r.cleared, r.rounds.length - 1);
  }
});

test('the winner is whoever is still standing, and both falling is a draw', () => {
  let wins = { a: 0, b: 0, draw: 0 };
  for (let i = 0; i < 200; i++) {
    const r = duel(A, B, bosses, config, `w${i}`, oddsAt);
    const last = r.rounds.at(-1);
    if (r.winner === 'a') assert.ok(last.a.cleared && !last.b.cleared);
    else if (r.winner === 'b') assert.ok(last.b.cleared && !last.a.cleared);
    else assert.ok(!last.a.cleared && !last.b.cleared);
    wins[r.winner ?? 'draw'] += 1;
  }
  // Both outcomes and the draw have to be reachable, or the mode has one ending.
  assert.ok(wins.a > 0 && wins.b > 0, `one side never won: ${JSON.stringify(wins)}`);
  assert.ok(wins.draw > 0, 'a draw was never possible');
});

test('the two sides draw their luck separately', () => {
  // The tempting version rolls one number per fight and checks it against both
  // builds — which makes the stronger build win every time the two differ, and
  // decides the duel by arithmetic before the first fight. If that ever creeps
  // back in, a weaker build will stop being able to steal one.
  const weak = buildFrom(0);
  const strongIds = [...pool].sort((x, y) => (y.scraped.quality ?? 0) - (x.scraped.quality ?? 0))
    .slice(0, 5).map((i) => i.id);

  let upsets = 0;
  for (let i = 0; i < 300; i++) {
    const r = duel(weak, strongIds, bosses, config, `u${i}`, oddsAt);
    const last = r.rounds.at(-1);
    // The strong side was likelier to clear the fight that ended it, and did not.
    if (last.a.cleared && !last.b.cleared && last.b.chance > last.a.chance) upsets += 1;
  }
  assert.ok(upsets > 0, 'the worse build could never steal one');
});

test('a build survives the round trip through a link, and a bad link cannot', () => {
  assert.equal(decodeBuild(encodeBuild(A), (id) => byId.has(id)).join(), A.join());

  // A link is text from somebody else. Everything it claims is checked against
  // the item data rather than trusted.
  assert.deepEqual(decodeBuild('NOT_A_REAL_ITEM,BRIMSTONE', (id) => byId.has(id)), ['COLLECTIBLE_BRIMSTONE']);
  assert.deepEqual(decodeBuild('', (id) => byId.has(id)), []);
  assert.deepEqual(decodeBuild(null, (id) => byId.has(id)), []);
  assert.deepEqual(decodeBuild('<script>', (id) => byId.has(id)), []);
});

test('a duel seed is short, unambiguous and stable', () => {
  const rng = mulberry32(42);
  const seeds = Array.from({ length: 200 }, () => newSeed(rng));
  for (const s of seeds) {
    assert.match(s, /^[a-z2-9]{8}$/);
    // These get read out loud, so the characters that sound or look alike are
    // not in the alphabet at all.
    assert.ok(!/[lio01]/.test(s), `${s} contains a character that is misread`);
  }
  assert.ok(new Set(seeds).size > 190, 'seeds collide too often');
});

test('both players are dealt the same five offers, and a different seed is a different deal', () => {
  const one = buildDeal(items, 'abcdefgh');
  const same = buildDeal(items, 'abcdefgh');
  const other = buildDeal(items, 'hgfedcba');

  assert.equal(one.rounds.length, DAILY_ROUNDS);
  assert.deepEqual(one.rounds, same.rounds, 'two players got different offers');
  assert.notDeepEqual(one.rounds, other.rounds);
  for (const round of one.rounds) assert.ok(round.candidates.length >= 4);
});

test('the duel deals through the daily dealer, so the two cannot drift apart', () => {
  // Same seed in, same rounds out: buildDaily is buildDeal with the date as the
  // seed, not a second implementation that could quietly diverge.
  const day = '2026-03-05';
  const viaDaily = buildDaily(items, day);
  assert.equal(viaDaily.rounds.length, DAILY_ROUNDS);
  for (const round of viaDaily.rounds) {
    assert.ok(round.candidates.length >= 4);
    assert.ok(round.pool && round.quality != null);
  }
});

test('a finished duel reads as a sentence and shares as a ladder', () => {
  const r = duel(A, B, bosses, config, 'share', oddsAt);
  const text = duelSummary(r);
  assert.match(text, /walked out|took you both/);
  assert.doesNotMatch(text, /took They|took You\b/, 'the sentence lost its grammar');

  // Forwarded to somebody who was not in it, no line may claim they were.
  const seeds = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'];
  for (const seed of seeds) {
    const one = duel(A, B, bosses, config, seed, oddsAt);
    const neutral = duelSummary(one, {
      a: 'The challenger', b: 'The one they sent it to', both: 'them both',
    });
    assert.doesNotMatch(neutral, /\byou\b/i, `"${neutral}" tells a stranger they were in it`);
  }

  const share = duelShare(r, 'share', 'https://example.test');
  const lines = share.split('\n');
  assert.equal(lines[0], 'The 13-0 — duel share');
  // One row per fight, two marks a row: the challenger and who they sent it to.
  assert.equal(lines.length, r.rounds.length + 3);
  for (const row of lines.slice(1, 1 + r.rounds.length)) {
    assert.equal([...row].length, 2);
  }
  assert.match(lines.at(-2), /wins on fight|Both fell/);
});
