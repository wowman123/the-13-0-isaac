/**
 * Composition + odds engine.
 *
 * Pure functions, no I/O, no DOM. Runs identically in the browser and in Node
 * so the calibration tool and the site can never drift apart.
 */

export const NEUTRAL = Object.freeze({
  offense: 1.0,
  aoe: 1.0,
  tracking: 0.0,
  defense: 1.0,
  evasion: 0.0,
});

export const AXES = Object.freeze(['offense', 'aoe', 'tracking', 'defense', 'evasion']);

/** Multiplicative axes soft-cap: linear until 3.5, then 40% credit beyond. */
export function softCap(x) {
  return x <= 3.5 ? x : 3.5 + 0.4 * (x - 3.5);
}

/** Diminishing-returns union, used for evasion: 1 - Π(1 - eᵢ). */
export function union(values) {
  return 1 - values.reduce((acc, e) => acc * (1 - e), 1);
}

/**
 * Combine per-item ratings into a single build vector.
 *
 * offense / aoe  multiply, then soft-cap
 * defense        multiplies, hard cap 4.0
 * tracking       max() — homing doesn't stack, you have it or you don't
 * evasion        diminishing union
 */
export function composeBuild(ratings) {
  if (!ratings.length) return { ...NEUTRAL };
  const product = (key) => ratings.reduce((acc, r) => acc * r[key], 1);
  return {
    offense: softCap(product('offense')),
    aoe: softCap(product('aoe')),
    defense: Math.min(product('defense'), 4.0),
    tracking: Math.max(...ratings.map((r) => r.tracking)),
    evasion: union(ratings.map((r) => r.evasion)),
  };
}

/**
 * Map a build vector into the scalar space the boss weights score against.
 *
 * The multiplicative axes go through log() so that "neutral" is 0 and a
 * halving is the exact mirror of a doubling. tracking and evasion are already
 * bounded 0..1 and are used as-is, which puts them on a comparable scale to
 * ln(offense) over the range offense actually reaches (~0 to ~1.25).
 */
export function toScoreSpace(build) {
  return {
    offense: Math.log(build.offense),
    aoe: Math.log(build.aoe),
    defense: Math.log(build.defense),
    tracking: build.tracking,
    evasion: build.evasion,
  };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Probability this build clears one specific fight.
 *
 * `config.slope` controls how sharply advantage converts into win rate, and
 * `config.difficulty` is a global offset added to every boss threshold. Both
 * are solved for by tools/calibrate.mjs against the targets in the schema —
 * they are not hand-tuned constants.
 */
export function bossOdds(build, boss, config) {
  const s = toScoreSpace(build);
  let score = 0;
  for (const axis of AXES) score += (boss.weights[axis] ?? 0) * s[axis];
  return sigmoid(config.slope * (score - (boss.threshold + config.difficulty)));
}

/** Per-fight odds plus the joint probability of clearing every fight. */
export function runOdds(build, bosses, config) {
  const perBoss = bosses.map((boss) => ({
    id: boss.id,
    name: boss.name,
    index: boss.index,
    p: bossOdds(build, boss, config),
  }));
  const total = perBoss.reduce((acc, b) => acc * b.p, 1);
  return { perBoss, total };
}

/** Convenience: ratings -> build -> odds, the whole pipeline in one call. */
export function evaluate(ratings, bosses, config) {
  const build = composeBuild(ratings);
  return { build, ...runOdds(build, bosses, config) };
}
