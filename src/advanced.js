/**
 * Composing a build in Advanced mode.
 *
 * Casual asks "how good is this item" and answers with a rating somebody
 * assigned. Advanced asks "what does this item do to my stats" and answers with
 * the game's own numbers, then runs the game's own curves over them.
 *
 * A build is still five items and still faces the same thirteen fights, so the
 * two modes end in the same place: five axes, fed to the same boss model. What
 * changes is everything before that.
 *
 *   stats     from data/item-stats.json, folded by the real damage and tear
 *             curves, measured against Isaac holding nothing
 *   mechanics from the tag table, because piercing and homing are behaviour
 *             rather than numbers and the game states no value for them
 *   synergies unchanged — how items interact is real in either mode
 *
 * A third source fills a gap the first two leave. 59 items were hand-rated for
 * Casual but publish no stat delta and carry no mechanic — Box of Friends,
 * Book of Revelations, BFFS. A hand rating is already a considered judgement of
 * what an item does in a fight, so Advanced uses it rather than pretending the
 * item does not exist. It applies only where nothing else describes the item:
 * an item with both a rating and a stat delta would otherwise be counted twice.
 *
 * Items that none of the three can describe are excluded from the Advanced pool
 * rather than offered as picks worth nothing.
 */

import { NEUTRAL, softCap, union } from './engine.js';
import { composeStats, statsToAxes, baselineStats, BASE } from './stats.js';
import { fromTags } from './ratings.js';
import { findSynergies, applySynergies, findTransformations } from './synergy.js';

/** Tags that describe tear behaviour rather than a stat. */
export const MECHANIC_TAGS = Object.freeze([
  'homing', 'laser', 'piercing', 'explosive', 'knife',
  'orbital', 'familiar', 'dot', 'spectral', 'multishot', 'charged', 'flight',
]);

const hasMechanic = (item) => (item.tags ?? []).some((t) => MECHANIC_TAGS.includes(t));

/** Can Advanced mode say anything about this item at all? */
export const isAdvancedItem = (item, statsById) =>
  Boolean(statsById[item.id]) || hasMechanic(item) || Boolean(item.rated);

/**
 * Items whose only description is a hand rating. Anything with a stat delta or
 * a mechanic is already accounted for, and folding its rating in as well would
 * count the same item twice.
 */
const handOnly = (items, statsById) =>
  items.filter((i) => i.rated && !statsById[i.id] && !hasMechanic(i));

/**
 * Fold the stat axes and the mechanic axes into one vector.
 *
 * The two describe different things, so they combine rather than compete:
 * stats set offense, defense and evasion; mechanics multiply offense and own
 * aoe and tracking outright.
 */
export function composeAdvanced(items, statsById, rules, transformations = null, character = BASE) {
  const deltas = items.map((i) => statsById[i.id]).filter(Boolean);
  const stats = composeStats(deltas, character);
  const axes = statsToAxes(stats, baselineStats());

  const mech = fromTags(items.flatMap((i) => (i.tags ?? []).filter((t) => MECHANIC_TAGS.includes(t))));

  let build = { ...NEUTRAL, ...axes };

  // Hand ratings compose the way they do in Casual: multiplicative axes
  // multiply, tracking takes the best on offer, evasion unions.
  for (const item of handOnly(items, statsById)) {
    const r = item.rated;
    build = {
      offense: build.offense * r.offense,
      aoe: build.aoe * r.aoe,
      tracking: Math.max(build.tracking, r.tracking),
      defense: build.defense * r.defense,
      evasion: union([build.evasion, r.evasion]),
    };
  }
  if (mech) {
    build = {
      offense: build.offense * mech.offense,
      aoe: build.aoe * mech.aoe,
      tracking: Math.max(build.tracking, mech.tracking),
      defense: build.defense * mech.defense,
      evasion: union([build.evasion, mech.evasion]),
    };
  }

  // The composition ceilings, the same ones casual builds answer to. These are
  // build-level and are not the per-item ranges in AXIS_RANGE — a finished
  // build is allowed further than any single item may go on its own.
  build = {
    offense: softCap(build.offense),
    aoe: softCap(build.aoe),
    tracking: Math.min(1, Math.max(0, build.tracking)),
    defense: Math.min(build.defense, 4.0),
    evasion: Math.min(1, Math.max(0, build.evasion)),
  };

  const fired = findSynergies(items, rules);
  build = applySynergies(build, fired);

  const transformed = transformations ? findTransformations(items, transformations) : [];
  if (transformed.length) build = applySynergies(build, transformed);

  return { build, stats, fired, transformed };
}
