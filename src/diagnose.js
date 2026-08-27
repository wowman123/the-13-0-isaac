/**
 * Why the run ended where it did.
 *
 * The ladder already shows which fight kills the most runs. What it does not
 * say is why — and "your build was not good enough" is not an answer anybody
 * can act on. This works out which axis the killing fight wanted that the build
 * did not bring.
 *
 * The comparison is against the build's own strongest axis rather than against
 * some external ideal. That keeps the claim modest and true: it says "this
 * fight leans on tracking and tracking is where you are thinnest", which is
 * something a player can do something about next draft, rather than pretending
 * to know what an ideal build looks like against this particular boss.
 */

import { AXES, toScoreSpace } from './engine.js';

/** Reads better than the internal axis names in the middle of a sentence. */
const AXIS_WORDS = {
  offense: 'damage',
  aoe: 'area coverage',
  tracking: 'tracking',
  defense: 'survivability',
  evasion: 'evasion',
};

/**
 * `perBoss` is what runOdds returned: one entry per fight with its clear
 * probability. The fight that ends the most runs is not the one you are least
 * likely to clear — a coin flip on the last fight costs fewer runs than a small
 * risk taken early, and the early one is the one worth knowing about.
 */
export function diagnose(build, perBoss, bosses) {
  if (!perBoss?.length) return null;

  let alive = 1;
  const rows = perBoss.map((b, i) => {
    const before = alive;
    alive *= b.p;
    return { ...b, boss: bosses[i], drop: before - alive };
  });

  const killer = rows.reduce((worst, r) => (r.drop > worst.drop ? r : worst), rows[0]);
  const weights = killer.boss?.weights ?? {};
  const s = toScoreSpace(build);

  // Where the build is thin, measured against its own best axis, weighted by
  // how much this particular fight cares.
  const best = Math.max(...AXES.map((a) => s[a]));
  const ranked = AXES
    .map((axis) => ({ axis, weight: weights[axis] ?? 0, shortfall: (weights[axis] ?? 0) * (best - s[axis]) }))
    .sort((a, b) => b.shortfall - a.shortfall);

  const culprit = ranked[0];
  return {
    fight: killer.boss?.name ?? killer.name,
    clears: killer.p,
    ends: killer.drop,
    axis: culprit.axis,
    word: AXIS_WORDS[culprit.axis] ?? culprit.axis,
    weight: culprit.weight,
    // Nothing useful to say when the build is even across the board, or when
    // the fight that ends the most runs barely weights anything it lacks.
    meaningful: culprit.shortfall > 0.05,
  };
}

/** The diagnosis as a sentence, or null when there is nothing honest to say. */
export function diagnosisText(d) {
  if (!d) return null;
  const ends = `${(d.ends * 100).toFixed(0)} of every 100 runs end at ${d.fight}`;
  if (!d.meaningful) {
    return `${ends}. Nothing in this build is especially weak — it is simply not big enough yet.`;
  }
  return `${ends}, and it leans on ${d.word} more than most fights do. That is where this build is thinnest.`;
}
