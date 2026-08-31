import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  duelCells, duelRound, duelLuck, runDepth, raceResult, raceSummary, duelShare,
  explainRace, explainText, encodeRun, decodeRun, newSeed, HEADSTART, DUEL_OFFER,
} from '../src/duel.js';
import { bossOdds, toScoreSpace } from '../src/engine.js';
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
const cells = duelCells(items);

const oddsAt = (ids, fight) => {
  const its = ids.map((id) => byId.get(id));
  const { build } = composeDraft(its, ids.map((id) => ratings.get(id)), rules, transformations);
  return bossOdds(build, fight, config);
};

/** Play a whole run on a seed, choosing with the given strategy each round. */
function play(seed, choose) {
  const picks = [];
  for (let n = 0; n < 400; n++) {
    const round = duelRound(cells, seed, n);
    picks.push(round.candidates[choose(round, n) % round.candidates.length]);
    if (picks.length > HEADSTART) {
      const r = runDepth(picks, bosses, seed, oddsAt);
      if (r.died) return { picks, ...r };
    }
  }
  return { picks, ...runDepth(picks, bosses, seed, oddsAt) };
}

test('both players get the same offers, whatever either of them is holding', () => {
  // This is the whole mode. Free play draws the next roll after you choose and
  // Endless bends it toward a family you are two into — either would hand two
  // players different offers the moment their builds diverged, which is pick
  // one. A duel round is a pure function of the seed and the depth.
  for (const n of [0, 1, 7, 40, 199]) {
    const one = duelRound(cells, 'raceseed', n);
    const two = duelRound(cells, 'raceseed', n);
    assert.deepEqual(one, two);
    assert.equal(one.candidates.length, DUEL_OFFER);
    assert.equal(new Set(one.candidates).size, one.candidates.length, 'a round offered a duplicate');
  }
  assert.notDeepEqual(duelRound(cells, 'raceseed', 7), duelRound(cells, 'otherseed', 7));
});

test('a duel has no end to deal to, so round two hundred works like round one', () => {
  const late = duelRound(cells, 'deep', 200);
  assert.equal(late.candidates.length, DUEL_OFFER);
  for (const id of late.candidates) assert.ok(byId.has(id));
});

test('every round is a real decision', () => {
  // Endless is happy to offer a cell holding one item. Here that is a round
  // neither player gets to play, and a race is decided by the real ones.
  for (let n = 0; n < 200; n++) {
    assert.equal(duelRound(cells, `s${n}`, n).candidates.length, DUEL_OFFER);
  }
});

test('the ladder is the same for both, fight by fight', () => {
  // One number per fight, from its own stream — so it does not matter how many
  // fights either player has had, or in what order the page asked for them.
  for (const depth of [0, 3, 25, 120]) {
    const u = duelLuck('same', depth);
    assert.equal(u, duelLuck('same', depth));
    assert.ok(u >= 0 && u < 1);
  }
  const spread = new Set(Array.from({ length: 50 }, (_, d) => duelLuck('same', d)));
  assert.equal(spread.size, 50, 'the same roll came up for different fights');
});

test('a run is its picks: the same picks on the same seed always end the same way', () => {
  const first = play('replay', () => 0);
  const again = runDepth(first.picks, bosses, 'replay', oddsAt);
  assert.equal(again.cleared, first.cleared);
  assert.deepEqual(again.fights.map((f) => f.cleared), first.fights.map((f) => f.cleared));

  // Which is what lets a link carry somebody's result without them reporting
  // it — their picks are their score, and there is nothing to take on trust.
  const roundTripped = decodeRun(encodeRun(first.picks), (id) => byId.has(id));
  assert.equal(runDepth(roundTripped, bosses, 'replay', oddsAt).cleared, first.cleared);
});

test('the first fights are free, so both players start level', () => {
  const r = runDepth(['COLLECTIBLE_SAD_ONION'], bosses, 'x', oddsAt);
  assert.equal(r.fights.length, 0, 'a fight happened before the headstart was over');
  assert.ok(HEADSTART >= 1);
});

test('a duel ends, and the run that ends it is the one that failed', () => {
  for (let i = 0; i < 25; i++) {
    const r = play(`end${i}`, () => i % DUEL_OFFER);
    assert.ok(r.died, 'the ladder let a run go on forever');
    assert.equal(r.fights.at(-1).cleared, false);
    for (const f of r.fights.slice(0, -1)) assert.ok(f.cleared);
    assert.equal(r.cleared, r.fights.length - 1);
  }
});

test('playing better goes deeper, which is the only thing a race can be about', () => {
  // Same seed, same offers, same luck for both. If picking well did not pay,
  // the mode would be a coin toss with extra steps.
  const greedy = (round, n) => {
    let best = 0;
    let bv = -1;
    for (let k = 0; k < round.candidates.length; k++) {
      const v = oddsAt([round.candidates[k]], bosses[Math.min(n, bosses.length - 1)]);
      if (v > bv) { bv = v; best = k; }
    }
    return best;
  };

  let good = 0;
  let blind = 0;
  for (let i = 0; i < 40; i++) {
    const seed = `race${i}`;
    const a = play(seed, greedy);
    const b = play(seed, () => 0);
    if (a.cleared > b.cleared) good += 1;
    else if (b.cleared > a.cleared) blind += 1;
  }
  assert.ok(good > blind, `picking well lost: ${good} to ${blind}`);
});

test('a race is decided on depth, and a tie is a tie', () => {
  const mine = { cleared: 7, fights: [], died: null };
  assert.equal(raceResult(mine, { cleared: 4 }).winner, 'you');
  assert.equal(raceResult(mine, { cleared: 9 }).winner, 'them');
  assert.equal(raceResult(mine, { cleared: 7 }).winner, 'draw');

  // Nobody having answered yet is not a result, and must not read as one.
  const alone = raceResult(mine, null);
  assert.equal(alone.winner, null);
  assert.equal(alone.waiting, true);
  assert.match(raceSummary(alone), /Send the link/);
  assert.doesNotMatch(raceSummary(alone), /went deeper|Dead level/);
});

test('a run survives the round trip through a link, and a bad link cannot', () => {
  const { picks } = play('trip', () => 0);
  assert.equal(decodeRun(encodeRun(picks), (id) => byId.has(id)).join(), picks.join());

  // A link is text from somebody else, checked against the item data rather
  // than trusted.
  assert.deepEqual(decodeRun('NOT_A_REAL_ITEM,BRIMSTONE', (id) => byId.has(id)), ['COLLECTIBLE_BRIMSTONE']);
  assert.deepEqual(decodeRun('', (id) => byId.has(id)), []);
  assert.deepEqual(decodeRun(null, (id) => byId.has(id)), []);
  assert.deepEqual(decodeRun('<script>', (id) => byId.has(id)), []);
});

test('a duel seed is short, unambiguous and stable', () => {
  const rng = mulberry32(42);
  const seeds = Array.from({ length: 200 }, () => newSeed(rng));
  for (const s of seeds) {
    assert.match(s, /^[a-z2-9]{8}$/);
    // These get read out loud, so the characters that are misheard or misread
    // are not in the alphabet at all.
    assert.ok(!/[lio01]/.test(s), `${s} contains a character that is misread`);
  }
  assert.ok(new Set(seeds).size > 190, 'seeds collide too often');
});

test('a finished race reads as a sentence and shares as two ladders', () => {
  const seed = 'shared';
  const mine = play(seed, () => 0);
  const theirs = play(seed, () => 3);
  const result = raceResult(mine, theirs);

  assert.match(raceSummary(result), /went deeper|Dead level/);

  const share = duelShare(result, seed, 'https://example.test');
  const lines = share.split('\n');
  assert.equal(lines[0], 'The 13-0 — duel shared');
  assert.equal([...lines[1]].length, mine.fights.length);
  assert.equal([...lines[2]].length, theirs.fights.length);
  assert.equal(lines[3], `${mine.cleared} v ${theirs.cleared}`);

  // Before anybody answers, the share is one ladder and no verdict.
  const alone = duelShare(raceResult(mine, null), seed);
  assert.equal(alone.split('\n').length, 3);
  assert.match(alone, /your turn/);
});

// --------------------------------------------------------------- explanation
const buildOf = (ids) => composeDraft(
  ids.map((id) => byId.get(id)), ids.map((id) => ratings.get(id)), rules, transformations,
).build;

const ctxFor = (seed) => ({
  scoreOf: (ids) => toScoreSpace(buildOf(ids)),
  buildOf,
  depthOf: (ids) => runDepth(ids, bosses, seed, oddsAt),
});

/** A handful of races with an explanation attached. */
function races(n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const seed = `why${i}`;
    let a = 0;
    let b = 0;
    const mine = play(seed, () => (a = (a * 7 + 3) % DUEL_OFFER));
    const theirs = play(seed, () => (b = (b * 5 + i + 1) % DUEL_OFFER));
    const result = raceResult(mine, theirs);
    out.push({ seed, result, x: explainRace(result, bosses, seed, ctxFor(seed)) });
  }
  return out;
}

test('the explanation names the exact bar both runs were measured against', () => {
  // Shared luck is what makes this sayable at all: one number per fight, and
  // one of you over it and one under. If the two ever came apart, every
  // sentence the panel prints about "the roll there" would be a lie.
  let seen = 0;
  for (const { result, x } of races()) {
    if (!x) continue;
    seen += 1;
    assert.ok(x.had < x.needed, 'the run that ended was not actually under the bar');
    if (result.winner === 'draw') assert.ok(x.theirs < x.needed, 'a draw had somebody over the bar');
    else assert.ok(x.theirs > x.needed, 'the run that survived was not actually over the bar');
  }
  assert.ok(seen >= 6, `only ${seen} races produced an explanation`);
});

test('the turning point is a run that could actually have happened', () => {
  for (const { seed, result, x } of races()) {
    if (!x?.turningPoint) continue;
    const t = x.turningPoint;

    // Both players saw the same offer at that depth, so the swapped-in item
    // must have been on the table for the one who did not take it.
    const offer = duelRound(cells, seed, t.round - 1).candidates;
    assert.ok(offer.includes(t.instead), `round ${t.round} never offered ${t.instead}`);
    assert.ok(offer.includes(t.took), `round ${t.round} never offered ${t.took}`);

    // And the depth it claims has to be the depth it reaches.
    const lost = result.winner === 'them' ? result.mine : result.winner === 'you' ? result.theirs : result.mine;
    const swapped = [...lost.picks];
    swapped[t.round - 1] = t.instead;
    const replay = runDepth(swapped, bosses, seed, oddsAt);
    assert.equal(replay.cleared, t.reached, 'the turning point promised a depth it does not reach');
    assert.ok(t.reached > x.depth, 'the turning point did not actually get further');
    assert.equal(t.atLeast, !replay.died);
  }
});

test('"no single pick would have got past it" is only said when it is true', () => {
  // The claim is checkable, so it has to be checked: every fork replayed, and
  // none of them further. Saying it loosely would be the panel inventing a
  // consolation.
  for (const { seed, result, x } of races()) {
    if (!x || x.turningPoint) continue;
    const lost = result.winner === 'them' ? result.mine : result.winner === 'you' ? result.theirs : result.mine;
    const won = lost === result.mine ? result.theirs : result.mine;

    for (let i = 0; i < lost.picks.length; i++) {
      if (!won.picks[i] || won.picks[i] === lost.picks[i]) continue;
      const swapped = [...lost.picks];
      swapped[i] = won.picks[i];
      assert.ok(
        runDepth(swapped, bosses, seed, oddsAt).cleared <= lost.cleared,
        `round ${i + 1} would have got further, and the panel said nothing would`,
      );
    }
  }
});

test('the explanation is written for a reader, not for a log', () => {
  const withText = races().filter(({ x }) => x);
  assert.ok(withText.length, 'no race produced an explanation');

  for (const { x } of withText) {
    const text = explainText(x, (id) => byId.get(id)?.name ?? id);
    assert.ok(text.length > 40);
    assert.doesNotMatch(text, /COLLECTIBLE_/, 'an item id reached the page');
    assert.doesNotMatch(text, /undefined|NaN|\[object/, `unfinished text: ${text}`);
    // Percentages carry a decimal: these margins are often under a point, and
    // rounding to whole percent prints two numbers that look equal.
    assert.match(text, /\d\.\d%/);
  }
});

test('there is nothing to explain until both runs are in', () => {
  const mine = play('alone', () => 0);
  assert.equal(explainRace(raceResult(mine, null), bosses, 'alone', ctxFor('alone')), null);
  assert.equal(explainText(null), null);
});
