/**
 * Advanced mode: Isaac's real stats, with the game's own formulas.
 *
 * Casual mode scores a build on five abstract axes — offense, aoe, tracking,
 * defense, evasion — invented for this project because they compose cleanly.
 * Advanced mode throws that away and computes what the game actually computes,
 * so the numbers on screen are the numbers a run would have.
 *
 * The two formulas that matter both carry a real square root, which is why
 * stacking damage ups stops paying and why the abstract soft cap in engine.js
 * was an approximation of something concrete:
 *
 *   damage    = base x (dmgUps x 1.2 + 1)^0.5, then flat adds, then multipliers
 *   tearDelay = 16 - 6 x sqrt(1.3 x tears + 1), floored, minimum 5
 *   fireRate  = 30 / (tearDelay + 1)    (the game runs at 30 frames a second)
 *
 * The tears stat counts tear ups and starts at zero, so Isaac's base delay is
 * 16 - 6 = 10 frames and his fire rate is 30/11 = 2.73 — which is the number
 * the game puts on his character sheet, and the check that these are the real
 * formulas rather than plausible ones.
 *
 * DPS is damage x fireRate, and it is the honest headline: two builds with the
 * same damage can differ threefold once fire rate is in.
 *
 * What is exact and what is modelled, stated plainly because the difference
 * matters: damage, tear delay, fire rate and the stat deltas are the game's.
 * How a mechanic like homing or piercing turns into effective DPS is this
 * project's model, and is marked as such wherever it is used.
 */

/** Isaac, the baseline every other character is quoted against. */
export const BASE = Object.freeze({
  damage: 3.5,
  damageMult: 1,
  tears: 0,
  tearsMult: 1,
  range: 6.5,
  shotSpeed: 1,
  speed: 1,
  luck: 0,
  health: 3,
  soulHearts: 0,
});

/** Below this the game clamps; above it, tears stop getting faster. */
const MIN_TEAR_DELAY = 5;
const FRAMES_PER_SECOND = 30;

/** Speed is hard-capped in game, and a build that ignores that lies to you. */
export const SPEED_CAP = 2.0;

/**
 * The damage curve. Regular damage ups go inside the square root, so the tenth
 * is worth a fraction of the first; a handful of items add flat damage that
 * skips the curve entirely, which is why they are so much stronger than they
 * look.
 */
export function damageFrom(damageUps, flatUps = 0, multiplier = 1, base = BASE.damage) {
  return (base * Math.sqrt(damageUps * 1.2 + 1) + flatUps) * multiplier;
}

/** Tear delay in frames, from the tears stat. Floored, as the game floors it. */
export function tearDelay(tears) {
  const raw = tears >= 0
    ? 16 - 6 * Math.sqrt(1.3 * tears + 1)
    // Negative tears is a real state — Soy Milk's opposite — and the curve
    // changes shape there rather than simply continuing.
    : 16 - 6 * Math.sqrt(Math.max(0, 1.3 * tears + 1)) - 6 * tears;
  return Math.max(MIN_TEAR_DELAY, Math.floor(raw));
}

/** Tears per second. The +1 is the frame the shot itself occupies. */
export const fireRate = (tears) => FRAMES_PER_SECOND / (tearDelay(tears) + 1);

/**
 * Fold a set of items into one stat line.
 *
 * `deltas` are the per-item numbers from data/item-stats.json: flat adds land
 * on the stat before its curve, multipliers land after.
 */
export function composeStats(deltas, character = BASE) {
  const start = { ...BASE, ...character };

  let damageUps = 0;
  let flatDamage = 0;
  let damageMult = start.damageMult ?? 1;
  let tears = start.tears;
  // Azazel fires at roughly a quarter of Isaac's rate and the Forgotten at
  // half; those are properties of the character, not of anything they picked
  // up, so the multiplier starts from them rather than at 1.
  let tearsMult = start.tearsMult ?? 1;
  let range = start.range;
  let shotSpeed = start.shotSpeed;
  let speed = start.speed;
  let luck = start.luck;
  let health = start.health;
  let soulHearts = start.soulHearts;

  for (const d of deltas) {
    if (!d) continue;
    damageUps += d.dmg ?? 0;
    if (d.dmg_x) damageMult *= d.dmg_x;
    tears += d.tears ?? 0;
    if (d.tears_x) tearsMult *= d.tears_x;
    range += d.range ?? 0;
    shotSpeed += d.shot_speed ?? 0;
    speed += d.speed ?? 0;
    luck += d.luck ?? 0;
    health += d.health ?? 0;
    soulHearts += d.soul_hearts ?? 0;
  }

  const damage = damageFrom(damageUps, flatDamage, damageMult, start.damage);
  // A fire-rate multiplier scales the resulting rate, not the stat behind it,
  // so it has to be applied after the curve rather than folded into `tears`.
  const rate = fireRate(tears) * tearsMult;

  return {
    damage,
    tears,
    tearDelay: tearDelay(tears),
    fireRate: rate,
    dps: damage * rate,
    range: Math.max(0, range),
    shotSpeed: Math.max(0, shotSpeed),
    speed: Math.min(SPEED_CAP, Math.max(0, speed)),
    luck,
    health,
    soulHearts,
    // Everything a hit has to chew through before the run ends.
    effectiveHealth: health * 2 + soulHearts,
  };
}

/** The same line for a character holding nothing, to compare a build against. */
export const baselineStats = (character = BASE) => composeStats([], character);

/**
 * Advanced mode still has to answer the same question casual does — can this
 * build clear thirteen fights — and that machinery is already built and
 * calibrated against real bosses. So rather than a second odds model, the real
 * stat line is mapped onto the same five axes.
 *
 * The difference is where the numbers come from. In casual, an item's offense
 * is a value somebody assigned it. Here it falls out of the damage curve and
 * the tear-delay curve: offense is what your DPS actually is, measured against
 * the same character holding nothing.
 *
 * The baseline is always Isaac holding nothing, for every character. Measuring
 * Judas against Judas would cancel his own damage multiplier out and make the
 * choice of character worth nothing, when it is exactly the thing Advanced mode
 * is meant to put in front of you.
 *
 * Two axes are not stats and cannot come from here. `aoe` and `tracking`
 * describe what your tears do — pierce, home, explode — which the game
 * expresses as behaviour rather than a number, so they keep coming from the
 * tag table. That split is the honest one: stats where the game gives stats,
 * a model where the game gives behaviour.
 */
export function statsToAxes(stats, baseline = baselineStats()) {
  const dpsRatio = baseline.dps > 0 ? stats.dps / baseline.dps : 1;
  const healthRatio = baseline.effectiveHealth > 0
    ? stats.effectiveHealth / baseline.effectiveHealth
    : 1;

  return {
    // DPS spans a much wider range than the hand-rated axes ever did — a strong
    // build is ten times the baseline, not three — so it is compressed onto the
    // scale the boss thresholds were solved against.
    offense: 1 + Math.log2(Math.max(0.25, dpsRatio)) * 0.42,
    aoe: 1,
    tracking: 0,
    defense: 1 + Math.log2(Math.max(0.25, healthRatio)) * 0.35,
    // Speed is dodging. It is capped at 2.0 in game, and the fraction of the
    // distance from the baseline to that cap is the fraction of hits avoided.
    evasion: Math.max(0, Math.min(0.85, (stats.speed - baseline.speed) / (SPEED_CAP - baseline.speed) * 0.7)),
  };
}
