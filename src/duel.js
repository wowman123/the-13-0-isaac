/**
 * The duel.
 *
 * You send a friend a link, they draft the same deal you did, and then the two
 * builds go down the ladder together until one of them falls. That is the whole
 * mode, and every part of it has to work without a server, because there is not
 * one — this is a static page.
 *
 * Three properties make that possible, and they are the reason the duel is
 * shaped the way it is rather than some more obvious way.
 *
 * **Both players answer the same question.** All five offers are dealt before
 * anybody picks, exactly as the daily deals them and for exactly the daily's
 * reason: in free play the next roll is drawn after you choose, so two people
 * who pick differently stop seeing the same offers from round two onward and
 * are no longer playing the same game. A duel on different deals would be a
 * comparison of luck.
 *
 * **The result is a pure function of the two builds and the seed.** Nothing is
 * rolled on one screen and reported to the other. Both players — and anybody
 * they forward the link to — compute the same fights from the same three
 * strings, which is what lets a link carry a finished duel with nothing behind
 * it.
 *
 * **The two builds draw their luck separately.** The tempting version is to
 * roll one number per fight and check it against both builds, but that makes
 * the stronger build win every single time the two differ, and the duel is then
 * decided by arithmetic before the first fight. Independent draws let a worse
 * build steal one, which is the only reason to play this with a person rather
 * than compare two percentages.
 */

import { mulberry32, hashString } from './random.js';
import { fightAt } from './endless.js';

/** How the two sides are named everywhere: the challenger, and who they sent it to. */
export const SIDES = ['a', 'b'];

/**
 * A cap on how long a duel can run.
 *
 * The ladder outruns any build eventually — that is the whole design of the
 * endless curve — so this is not what ends a duel in practice. It is here so
 * that a corrupt or hand-edited link cannot spin the page forever.
 */
const MAX_FIGHTS = 500;

/** Items in a build, shortened for a URL. `COLLECTIBLE_BRIMSTONE` -> `BRIMSTONE`. */
export const encodeBuild = (ids) => ids.map((id) => id.replace(/^COLLECTIBLE_/, '')).join(',');

/**
 * The other direction, and the only place a link is trusted.
 *
 * A link is text from someone else, so everything it claims is checked against
 * the item data: unknown ids are dropped rather than carried around as holes,
 * and `exists` is how the page tells a real challenge from a typo.
 */
export function decodeBuild(text, exists = () => true) {
  return String(text ?? '')
    .split(',')
    .filter(Boolean)
    .map((x) => `COLLECTIBLE_${x.replace(/[^A-Z0-9_]/gi, '').toUpperCase()}`)
    .filter(exists);
}

/**
 * The seed both players' deals come from.
 *
 * Short, pronounceable over a voice call, and case-insensitive, because these
 * get read out loud and retyped more often than you would think.
 */
export function newSeed(rng = Math.random) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no l/i/o/0/1
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/**
 * Run the duel.
 *
 * `oddsAt(build, fight)` is the caller's business — the page has two different
 * models and this does not need to know which one it is holding. Both sides
 * face the same fight at the same time, each at its own chance, and the first
 * to fall loses. Falling on the same fight is a draw, which is the honest
 * answer: they died in the same room.
 */
export function duel(a, b, bosses, config, seed, oddsAt) {
  const rng = mulberry32(hashString(`the-13-0:duel:${seed}:${encodeBuild(a)}:${encodeBuild(b)}`));
  const rounds = [];

  for (let depth = 0; depth < MAX_FIGHTS; depth++) {
    const fight = fightAt(depth, bosses);
    const side = (build) => {
      const chance = oddsAt(build, fight, config);
      // Drawn before the comparison, and one per side per fight, so the stream
      // does not depend on who happened to survive — the same two builds
      // always fight the same duel.
      return { chance, cleared: rng() < chance };
    };

    const round = { label: fight.label, depth, a: side(a), b: side(b) };
    rounds.push(round);

    if (!round.a.cleared || !round.b.cleared) {
      const winner = round.a.cleared ? 'a' : round.b.cleared ? 'b' : null;
      return { rounds, winner, cleared: depth, ended: round };
    }
  }

  // Unreachable against the real ladder; here so a broken link cannot hang.
  return { rounds, winner: null, cleared: MAX_FIGHTS, ended: null, capped: true };
}

/**
 * How a finished duel reads in one line.
 *
 * Named from wherever the reader is standing. The two who fought it get "you"
 * and "they"; somebody the link was forwarded to gets neither, because they
 * were not in it — a line telling a stranger that a boss "took you both" is
 * telling them something untrue.
 */
export function duelSummary(result, names = {}) {
  const { a = 'You', b = 'They', both = 'you both' } = names;
  const { winner, cleared, ended } = result;
  const depth = `${cleared} fight${cleared === 1 ? '' : 's'} deep`;

  if (!ended) return `Still standing after ${cleared} fights.`;
  if (!winner) return `${ended.label} took ${both}, ${depth}.`;

  // Both names are used as subjects, so a caller can pass plain labels without
  // the sentence needing "they"/"them" forms for each of them.
  const sides = { a, b };
  const won = sides[winner];
  const lost = sides[winner === 'a' ? 'b' : 'a'];
  return `${lost} fell to ${ended.label}, ${depth}. ${won} walked out.`;
}

/** Emoji ladder for a finished duel, one row per fight, challenger first. */
export function duelShare(result, seed, site = '') {
  const mark = (s) => (s.cleared ? (s.chance >= 0.75 ? '🟩' : s.chance >= 0.4 ? '🟨' : '🟧') : '💀');
  const rows = result.rounds.map((r) => `${mark(r.a)}${mark(r.b)}`).join('\n');
  const verdict = result.winner
    ? `${result.winner === 'a' ? 'Challenger' : 'Challenged'} wins on fight ${result.cleared + 1}`
    : `Both fell on fight ${result.cleared + 1}`;

  return [`The 13-0 — duel ${seed}`, rows, verdict, site].filter(Boolean).join('\n');
}
