/**
 * Endless mode.
 *
 * The five-pick draft asks one question: how good a build can you assemble
 * blind. Endless asks a different one — can your build grow faster than the
 * ladder climbs. You take one item, then face one fight. Clear it and you draft
 * again, with the build you have. Lose and that is the run.
 *
 * So the tension inverts. In a five-pick draft a weak early item is a slot you
 * wasted. Here it is a fight you might not survive to regret, and an item that
 * pays off in four rounds is worth nothing if round two kills you.
 *
 * The thirteen real fights come first, in order. Past them the ladder keeps
 * climbing rather than stopping: the same fights come round again, harder each
 * lap, because a build that clears all thirteen should be asked how much
 * further it can go rather than simply told it won.
 */

/** The gap between consecutive thresholds on the real ladder. */
const STEP = 0.2;

/**
 * Picks taken before the first fight.
 *
 * The ladder was solved against five-item builds, so walking into Basement I
 * holding one item is not a hard start, it is a broken one — a third of runs
 * would end on the opening fight before the mode had shown you anything. Three
 * free picks put the build roughly where the difficulty expects it, and from
 * there each fight costs one pick to reach, which is the actual race.
 */
export const HEADSTART = 3;

/** How many picks a run has taken by the time it faces fight `depth`. */
export const picksAtDepth = (depth) => depth + HEADSTART + 1;

/**
 * How much steeper each lap is than the last.
 *
 * A constant rise does not work. The build gains an item per fight and never
 * loses one, and although every axis is capped the composed score still climbs
 * roughly linearly with the count — so against a ladder that also climbs
 * linearly, a good run simply never ends. Half of them ran past two hundred
 * fights before this existed. Making each lap steeper than the one before puts
 * the ladder on a curve the build cannot outrun, so every run has an end even
 * though no run has a fixed length.
 *
 * It grows with the square of how far past the real ladder you are, rather
 * than stepping once per lap. Stepping put a wall at the boundary — a run
 * cleared twelve fights and then met one four whole thresholds higher, which is
 * not a difficulty curve but a cliff with a corridor in front of it.
 *
 * The first thirteen are left exactly as they are, so an endless run opens on
 * the real game and clearing it means what it means everywhere else on this
 * site. That does make the opening lap comfortable for a build that is by then
 * sixteen items deep, and the honest description of the shape is a long cruise
 * and then a fast ending rather than a gentle slide — which is what a survival
 * mode is. The per-fight odds are on screen the whole way, so the wall is
 * visible well before you hit it.
 *
 * Tuned by simulation rather than by feel: picking at random dies around the
 * tenth fight, picking well reaches the low thirties, and no simulated run
 * failed to end.
 */
const CURVE = 14;

/**
 * The fight at a given depth, counting from zero.
 *
 * Beyond the thirteenth the fights repeat with their thresholds continuing to
 * climb at the same rate, so lap two is strictly harder than lap one and the
 * curve never flattens into a run that cannot end.
 */
export function fightAt(depth, bosses) {
  const lap = Math.floor(depth / bosses.length);
  const boss = bosses[depth % bosses.length];
  if (lap === 0) return { ...boss, depth, lap, label: boss.name };

  return {
    ...boss,
    depth,
    lap,
    threshold: boss.threshold + climb(depth, bosses),
    label: `${boss.name} +${lap}`,
  };
}

/**
 * How far above the real ladder a fight at this depth sits: the ladder's own
 * rise carried on lap after lap, plus the quadratic term that eventually
 * outruns any build.
 */
function climb(depth, bosses) {
  const n = bosses.length;
  const lap = Math.floor(depth / n);
  const lapRise = bosses[n - 1].threshold - bosses[0].threshold + STEP;

  // The linear part is already continuous across the boundary: the last real
  // fight sits at 2.8 and the first of lap two at 0 + 3.0, one step further on,
  // exactly as if the ladder had carried straight on. The quadratic term has to
  // start from nothing there too, or beating the game is rewarded with a wall.
  const beyond = Math.max(0, depth - n) / n;
  return lapRise * lap + CURVE * beyond ** 2;
}

/**
 * How the run reads once it is over.
 *
 * Depth is the honest score — the number of fights actually cleared — and it is
 * what two players compare. The build that got there is secondary; a lucky
 * eighth fight counts the same as a deserved one, which is the deal endless
 * makes with you.
 */
export function endlessSummary(fights) {
  const cleared = fights.filter((f) => f.cleared).length;
  const last = fights[fights.length - 1];
  return {
    cleared,
    died: last && !last.cleared ? last : null,
    // The fight you were least likely to survive and did, which is usually the
    // more interesting number than the one that finally got you.
    luckiest: fights
      .filter((f) => f.cleared)
      .reduce((worst, f) => (worst === null || f.chance < worst.chance ? f : worst), null),
  };
}

/** Emoji ladder for sharing an endless run, one block per fight attempted. */
export function endlessShare(fights, site = '') {
  const blocks = fights
    .map((f) => (f.cleared ? (f.chance >= 0.75 ? '🟩' : f.chance >= 0.4 ? '🟨' : '🟧') : '💀'))
    .join('');
  const cleared = fights.filter((f) => f.cleared).length;
  return [
    `The 13-0 — endless`,
    blocks,
    `${cleared} fight${cleared === 1 ? '' : 's'} cleared`,
    site,
  ].filter(Boolean).join('\n');
}
