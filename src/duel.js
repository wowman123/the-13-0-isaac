/**
 * The duel: one endless run, two people, at the same time.
 *
 * You send a friend a link and you both play immediately. Neither of you waits
 * for the other, and neither is playing a recording of the other — you are
 * playing *the same run*. Same offers at every depth, same ladder, same luck.
 * The only thing that differs is what each of you takes, and whoever gets
 * deeper wins.
 *
 * This is a static page with no server, so nothing can pass between two
 * browsers while they play. What makes it a real race anyway is that the whole
 * run is derivable from one short seed: both screens generate the identical
 * sequence of offers and the identical sequence of fights without ever needing
 * to agree on anything, because there is nothing to agree about.
 *
 * Three things follow from that, and they are the whole design.
 *
 * **The offers cannot depend on your picks.** Free play draws the next roll
 * after you choose, and Endless bends the roll toward a family you are two
 * into — either of which hands two players different offers the moment their
 * builds diverge, which is the first pick. So a duel's rolls come from the seed
 * and the depth alone. Round nine is the same round nine for both of you
 * whatever you are holding, and there is no lean.
 *
 * **The luck is shared too.** One number per fight, drawn from the seed, and
 * each of you clears it or does not according to your own odds against it.
 * Independent draws would be the fairer way to settle a fight between two
 * builds; here they would mean one of you got an easier run than the other, and
 * a race where the ladder was kinder to one runner is not a race.
 *
 * **Nobody has to report anything.** A run is its picks, and its depth follows
 * from them, so a link carrying somebody's picks carries their result whether
 * they like it or not. There is no score to take on trust and none to fake.
 */

import { mulberry32, hashString, sampleWith, pickWith } from './random.js';
import { fightAt, HEADSTART } from './endless.js';

export { HEADSTART };

/** Candidates per offer, and the qualities a roll can land on. */
export const DUEL_OFFER = 6;
const QUALITIES = [0, 1, 2, 3, 4];

/**
 * Thin cells make a poor round in a race.
 *
 * Endless is happy to offer a cell holding one item — that is the game being
 * honest about its own pools. Here it is a round neither player gets to play,
 * identically, and a race should be decided by rounds that were decisions. So a
 * duel rolls only cells that can fill a whole offer: fifty-six of the ninety-
 * nine intersections can, spread across all five qualities, which is variety
 * enough for a run that never ends.
 */
const MIN_CHOICES = DUEL_OFFER;

/** Items in a run, shortened for a URL. `COLLECTIBLE_BRIMSTONE` -> `BRIMSTONE`. */
export const encodeRun = (ids) => ids.map((id) => id.replace(/^COLLECTIBLE_/, '')).join(',');

/**
 * The other direction, and the only place a link is trusted.
 *
 * A link is text from somebody else, so everything it claims is checked against
 * the item data: unknown ids are dropped rather than carried around as holes.
 */
export function decodeRun(text, exists = () => true) {
  return String(text ?? '')
    .split(',')
    .filter(Boolean)
    .map((x) => `COLLECTIBLE_${x.replace(/[^A-Z0-9_]/gi, '').toUpperCase()}`)
    .filter(exists);
}

/**
 * The seed both runs come from.
 *
 * Short, and case-insensitive, because these get read out loud and retyped more
 * often than you would think. The characters that sound or look like each other
 * are not in the alphabet at all.
 */
export function newSeed(rng = Math.random) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no l/i/o/0/1
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/**
 * Every intersection a duel roll can land on, with what is in it.
 *
 * Nothing is ever taken out. A duel is endless, and a run that can outlast the
 * pool cannot afford depletion — but more than that, depletion depends on your
 * picks, and anything that depends on your picks gives the two of you different
 * rounds.
 */
export function duelCells(items, isRealPool = (p) => !p.startsWith('greed')) {
  const draftable = items.filter(
    (i) => i.scraped?.quality != null && (i.scraped?.pools ?? []).some(isRealPool),
  );
  const pools = [...new Set(draftable.flatMap((i) => i.scraped.pools.filter(isRealPool)))].sort();

  const cells = [];
  for (const pool of pools) {
    for (const quality of QUALITIES) {
      const inCell = draftable.filter(
        (i) => i.scraped.quality === quality && i.scraped.pools.includes(pool),
      );
      if (inCell.length) cells.push({ pool, quality, inCell });
    }
  }
  return cells;
}

/**
 * Round `n` of a duel, dealt from the seed and the depth alone.
 *
 * Generated on demand rather than dealt up front, because the run has no end to
 * deal to — but every round is a pure function of `(seed, n)`, so the hundredth
 * is as reproducible as the first and both players reach the same one.
 */
export function duelRound(cells, seed, n) {
  const rng = mulberry32(hashString(`the-13-0:duel:${seed}:round:${n}`));
  const roomy = cells.filter((c) => c.inCell.length >= MIN_CHOICES);
  const { pool, quality, inCell } = pickWith(rng, roomy.length ? roomy : cells);
  return { pool, quality, candidates: sampleWith(rng, inCell, DUEL_OFFER).map((i) => i.id) };
}

/**
 * The one number that decides fight `depth`, for both players.
 *
 * Drawn from its own stream rather than from a running one, so it does not
 * matter how many fights either player has had or in what order the page asked:
 * depth eleven is the same roll on both screens, always.
 */
export const duelLuck = (seed, depth) =>
  mulberry32(hashString(`the-13-0:duel:${seed}:fight:${depth}`))();

/**
 * How deep a set of picks gets on this seed.
 *
 * The run is replayed rather than remembered: given the picks, the ladder and
 * the seed there is exactly one answer, which is why a link carrying somebody
 * else's picks carries their result too.
 *
 * `oddsAt(ids, fight)` is the caller's business — this does not need to know
 * which of the site's two models it is holding.
 */
export function runDepth(picks, bosses, seed, oddsAt) {
  const fights = [];
  for (let i = HEADSTART; i < picks.length; i++) {
    const depth = i - HEADSTART;
    const fight = fightAt(depth, bosses);
    const chance = oddsAt(picks.slice(0, i + 1), fight);
    const cleared = duelLuck(seed, depth) < chance;
    fights.push({ label: fight.label, depth, chance, cleared });
    if (!cleared) break;
  }
  const last = fights.at(-1);
  return {
    picks: [...picks],
    fights,
    cleared: fights.filter((f) => f.cleared).length,
    died: last && !last.cleared ? last : null,
  };
}

/** Who got deeper. A tie is a tie: the same question, answered equally well. */
export function raceResult(mine, theirs) {
  if (!theirs) return { winner: null, mine, theirs: null, waiting: true };
  const winner = mine.cleared > theirs.cleared ? 'you'
    : theirs.cleared > mine.cleared ? 'them'
      : 'draw';
  return { winner, mine, theirs, waiting: false };
}

const depthText = (n) => `${n} fight${n === 1 ? '' : 's'} cleared`;

/** How a race reads in one line, from the side of whoever is reading it. */
export function raceSummary(result) {
  if (result.waiting) {
    return `${depthText(result.mine.cleared)}. Send the link — whoever opens it plays this same run, and the deeper one wins.`;
  }
  const { mine, theirs, winner } = result;
  const both = `${depthText(mine.cleared)} against their ${theirs.cleared}`;
  if (winner === 'draw') return `${both}. Dead level — the same run, answered just as well.`;
  return `${both}. ${winner === 'you' ? 'You' : 'They'} went deeper.`;
}

/** Emoji ladder for a run, one block a fight. */
export function duelShare(result, seed, site = '') {
  const ladder = (r) => r.fights
    .map((f) => (f.cleared ? (f.chance >= 0.75 ? '🟩' : f.chance >= 0.4 ? '🟨' : '🟧') : '💀'))
    .join('');

  const lines = [`The 13-0 — duel ${seed}`, ladder(result.mine)];
  if (result.theirs) {
    lines.push(ladder(result.theirs));
    lines.push(`${result.mine.cleared} v ${result.theirs.cleared}`);
  } else {
    lines.push(`${depthText(result.mine.cleared)} — same run, your turn`);
  }
  return [...lines, site].filter(Boolean).join('\n');
}

/**
 * Why one run beat the other.
 *
 * A race on identical conditions is the one place where "why did I lose" has a
 * real answer rather than a shrug. Both of you met the same offers and the same
 * rolls, so every difference in the outcome traces back to a pick — and because
 * the luck is shared, the fight that ended a run came with an exact bar
 * attached. One of you was over that number and one was under it, so the
 * explanation can say what each of you needed and what each of you had rather
 * than gesturing at variance.
 *
 * Three things it works out, in the order a player would ask them.
 *
 * What ended it, and by how much. The shared roll at that depth is the bar.
 *
 * What the fight wanted. Every boss weights the five axes differently, so the
 * gap worth naming is the one that fight was actually asking about — being
 * ahead on damage costs nothing against a fight that does not care about it.
 *
 * Where it was decided. Every round the two of you differed is a fork that can
 * be replayed: put the other build's item in, keep everything else the same,
 * and see how far it gets. Both of you saw the same offer at that depth, so it
 * is always a run that could have happened. The replay can only use picks that
 * were actually made, so it reports a floor rather than a fantasy. And when no
 * single swap changes anything, that is the answer: the gap was not one pick.
 */

/** Reads better than the internal axis names in the middle of a sentence. */
const AXIS_WORDS = {
  offense: 'damage',
  aoe: 'area coverage',
  tracking: 'tracking',
  defense: 'survivability',
  evasion: 'evasion',
};

/** A swap has to actually get further to be worth calling a turning point. */
const TURNING_POINT_MIN = 1;

/** How many picks a build has by the time it faces fight `depth`. */
const depthPicks = (depth) => depth + HEADSTART + 1;

/**
 * `ctx` supplies everything model-specific: `scoreOf(ids)` for a build's five
 * axes in score space, `buildOf(ids)` for the same axes unlogged, and
 * `depthOf(ids)` to replay a set of picks.
 */
export function explainRace(result, bosses, seed, ctx) {
  if (!result || result.waiting || !result.theirs) return null;

  const { mine, theirs, winner } = result;
  // On a draw there is no loser, but there is still a fight that ended both
  // runs and still a pick that would have broken the tie.
  const lost = winner === 'them' ? mine : winner === 'you' ? theirs : mine;
  const won = lost === mine ? theirs : mine;
  if (!lost.died) return null;

  const depth = lost.died.depth;
  const fight = fightAt(depth, bosses);
  const wonAt = won.fights.find((f) => f.depth === depth) ?? null;

  return {
    winner,
    fight: fight.label,
    depth,
    needed: duelLuck(seed, depth),
    had: lost.died.chance,
    theirs: wonAt?.chance ?? null,
    axis: biggestGap(fight, ctx, won.picks, lost.picks, depth),
    turningPoint: turningPoint(lost, won, ctx),
  };
}

/**
 * Which axis this fight asked about that one build had and the other did not.
 *
 * Ranked in score space, where the boss weights apply, so the axis named is the
 * one that fight cared about rather than the largest gap anywhere. Reported as
 * the raw build values, because "2.4x to 1.6x" means something to a player and
 * a pair of logs does not.
 */
function biggestGap(fight, ctx, wonPicks, lostPicks, depth) {
  const at = (picks) => picks.slice(0, depthPicks(depth));
  const wonScore = ctx.scoreOf(at(wonPicks));
  const lostScore = ctx.scoreOf(at(lostPicks));
  const wonBuild = ctx.buildOf(at(wonPicks));
  const lostBuild = ctx.buildOf(at(lostPicks));
  const weights = fight.weights ?? {};

  const ranked = Object.keys(AXIS_WORDS)
    .map((axis) => ({
      axis,
      word: AXIS_WORDS[axis],
      weight: weights[axis] ?? 0,
      gap: (weights[axis] ?? 0) * ((wonScore[axis] ?? 0) - (lostScore[axis] ?? 0)),
      won: wonBuild[axis],
      lost: lostBuild[axis],
      // Offense, aoe and defense are multipliers; tracking and evasion are 0-1.
      multiplier: axis === 'offense' || axis === 'aoe' || axis === 'defense',
    }))
    .sort((a, b) => b.gap - a.gap);

  // Nothing honest to say when the winner was not actually ahead on anything
  // this fight weighted — they were over the bar and the other was not.
  const top = ranked[0];
  return top && top.gap > 0.02 ? top : null;
}

/**
 * The fork the race turned on.
 *
 * Every round the two differed is replayable: the other build's item was in
 * this one's offer too, because both saw the same offer. Swapping it in and
 * keeping everything else is therefore a run that could have happened — and the
 * one that gains most is where it was decided.
 */
function turningPoint(lost, won, ctx) {
  let best = null;

  for (let i = 0; i < lost.picks.length; i++) {
    const other = won.picks[i];
    if (!other || other === lost.picks[i]) continue;

    const swapped = [...lost.picks];
    swapped[i] = other;
    const reached = ctx.depthOf(swapped);
    const gained = reached.cleared - lost.cleared;
    if (gained >= TURNING_POINT_MIN && (!best || gained > best.gained)) {
      best = {
        round: i + 1,
        took: lost.picks[i],
        instead: other,
        reached: reached.cleared,
        gained,
        // The replay only has the picks that were actually made, so surviving
        // to the end of them is a floor, not a finish.
        atLeast: !reached.died,
      };
    }
  }
  return best;
}

/**
 * The explanation as a short paragraph, written from the reader's side.
 *
 * `nameOf` turns an item id into its name; without it the sentence would be
 * full of COLLECTIBLE_ ids.
 */
export function explainText(x, nameOf = (id) => id) {
  if (!x) return null;
  // One decimal, because these margins are often under a point and rounding to
  // whole percent turns "79.0 against a bar of 80.9" into "79 against 81" — or
  // worse, into two numbers that look equal.
  const pct = (p) => `${(p * 100).toFixed(1)}%`;
  const draw = x.winner === 'draw';
  const youLost = x.winner === 'them';
  const lost = draw ? 'you' : youLost ? 'you' : 'they';
  const won = lost === 'you' ? 'they' : 'you';

  const lines = [
    draw
      ? `${x.fight} ended both runs. The roll there was ${pct(x.needed)}: you came in at ${pct(x.had)}`
        + (x.theirs != null ? `, they at ${pct(x.theirs)}` : '') + '.'
      : `${x.fight} ended ${lost === 'you' ? 'your' : 'their'} run. The roll there was ${pct(x.needed)},`
        + ` and clearing it meant beating that: ${lost} came in at ${pct(x.had)}`
        + (x.theirs != null ? `, ${won} at ${pct(x.theirs)}` : '') + '.',
  ];

  if (x.axis && !draw) {
    // Multiplier axes compound over a long run and reach numbers like 272x,
    // which is true and unreadable. The ratio between the two is the part that
    // means anything. Bounded axes are already on a scale a player can read.
    const gap = x.axis.multiplier && x.axis.lost > 0
      ? `${won} had ${(x.axis.won / x.axis.lost).toFixed(1)}x the ${x.axis.word} ${lost} did`
      : `${won} were at ${x.axis.won.toFixed(2)} to ${lost === 'you' ? 'your' : 'their'} ${x.axis.lost.toFixed(2)}`;
    lines.push(`That fight leans on ${x.axis.word}, and it is where the two builds were furthest apart: ${gap}.`);
  }

  if (x.turningPoint) {
    const t = x.turningPoint;
    lines.push(
      `It turned on round ${t.round}: ${lost} took ${nameOf(t.took)}, ${won} took ${nameOf(t.instead)}.`
      + ` Swap that one pick, keep everything else the same, and ${lost} reach`
      + ` ${t.atLeast ? 'at least ' : ''}${t.reached} instead of ${x.depth}.`,
    );
  } else {
    // Said only when it is true: every fork was replayed and none of them got
    // past the fight that ended it.
    lines.push(
      `No single pick would have got past it. Every round the two of you differed was`
      + ` replayed with the other item in its place, and ${lost === 'you' ? 'you' : 'they'} still`
      + ` ${draw ? 'end up level' : 'end up in the same room'} — the gap was the whole build rather than one round.`,
    );
  }

  return lines.join(' ');
}
