/**
 * Turning an item record into a rating vector.
 *
 * Hand-rated items are used verbatim. Everything else falls through to the
 * tag table, and anything with no usable tags falls through again to the
 * quality curve — so nothing ever ships unrated.
 */

import { NEUTRAL, union } from './engine.js';

/** Per-item legal ranges from the schema. Enforced on resolve, not on trust. */
export const AXIS_RANGE = Object.freeze({
  offense: [0.5, 3.0],
  aoe: [0.5, 3.0],
  tracking: [0.0, 1.0],
  defense: [0.8, 2.5],
  evasion: [0.0, 1.0],
});

/**
 * `tracking` splits into two kinds of entry: an absolute floor the mechanic
 * grants you (homing gives 0.90 whatever else is going on) and a multiplier
 * that scales whatever you ended up with (charged costs you 40% of it).
 *
 * Two kinds of tag live here. The first twelve are mechanics — how your tears
 * behave. The rest are stat movements read off the game's own `cache`
 * attribute, which says which stats an item touches. Those are deliberately
 * mild: the quality curve already answers "how good is this item", and these
 * only have to answer "good at what". Without them 414 of 693 draftable items
 * had no usable tag at all and fell through to quality alone, which made every
 * item in a Pool x Quality cell numerically identical to its neighbours.
 */
export const TAG_TABLE = Object.freeze({
  homing:     { tracking: 0.90 },
  laser:      { offense: 1.15, aoe: 1.30, tracking: 0.30 },
  piercing:   { aoe: 1.40 },
  explosive:  { offense: 1.20, aoe: 1.60, tracking: 0.20, defense: 0.90 },
  knife:      { offense: 1.30, aoe: 0.70, tracking: 0.50 },
  orbital:    { aoe: 1.20, tracking: 0.60, defense: 1.15 },
  familiar:   { offense: 1.10, tracking: 0.70 },
  dot:        { offense: 1.15 },
  spectral:   { trackingMult: 1.10 },
  multishot:  { offense: 1.25, aoe: 1.30 },
  charged:    { trackingMult: 0.60 },
  flight:     { evasion: 0.35 },

  // An active item is a burst you fire, not a stat you carry. Worth something
  // for clearing a room, but it cannot carry a run the way a damage up does —
  // and the "two actives" conflict already punishes stacking them.
  active:     { offense: 1.08, aoe: 1.15 },

  // Stat movements, from `cache`.
  damage_up:  { offense: 1.18 },
  tears_up:   { offense: 1.15 },
  range_up:   { offense: 1.05, aoe: 1.08 },
  shot_speed: { offense: 1.04 },
  luck_up:    { offense: 1.05 },
  speed_up:   { evasion: 0.20 },
  health_up:  { defense: 1.20 },
  soul_hearts:  { defense: 1.12 },
  black_hearts: { defense: 1.10, aoe: 1.10 },
});

/** Offense-only fallback for items with no rating and no usable tags. */
export const QUALITY_OFFENSE = Object.freeze({ 0: 1.00, 1: 1.08, 2: 1.18, 3: 1.35, 4: 1.60 });

const clamp = (v, [lo, hi]) => Math.min(Math.max(v, lo), hi);

function clampVector(v) {
  const out = {};
  for (const axis of Object.keys(AXIS_RANGE)) out[axis] = clamp(v[axis], AXIS_RANGE[axis]);
  return out;
}

/** Apply the tag table. Returns null when no tag in the list is recognised. */
export function fromTags(tags = []) {
  const known = tags.filter((t) => TAG_TABLE[t]);
  if (!known.length) return null;

  const v = { ...NEUTRAL };
  const trackingFloors = [];
  const trackingMults = [];
  const evasionParts = [];

  for (const tag of known) {
    const e = TAG_TABLE[tag];
    if (e.offense) v.offense *= e.offense;
    if (e.aoe) v.aoe *= e.aoe;
    if (e.defense) v.defense *= e.defense;
    if (e.tracking != null) trackingFloors.push(e.tracking);
    if (e.trackingMult != null) trackingMults.push(e.trackingMult);
    if (e.evasion != null) evasionParts.push(e.evasion);
  }

  // Floors don't stack with each other (same reason tracking uses max() at
  // build level), then the multipliers scale the result.
  v.tracking = trackingFloors.length ? Math.max(...trackingFloors) : 0;
  for (const m of trackingMults) v.tracking *= m;
  v.evasion = union(evasionParts);

  return clampVector(v);
}

/** Offense from the quality curve, everything else neutral. */
export function fromQuality(quality) {
  const offense = QUALITY_OFFENSE[quality];
  if (offense == null) return null;
  return { ...NEUTRAL, offense };
}

/**
 * The single entry point the site and the tools both use.
 * Returns the vector plus a `source` saying which layer actually produced it.
 */
export function resolveRating(item) {
  if (item.rated && item.rated.source === 'hand') {
    return { ...clampVector({ ...NEUTRAL, ...item.rated }), source: 'hand' };
  }

  // Quality and tags answer different questions — roughly how good is it, and
  // what does it do — so an item with both should use both. Taking tags alone
  // would throw away the quality of, say, a Q4 flight item and rate it neutral.
  const tagged = fromTags(item.tags);
  const byQuality = fromQuality(item.scraped?.quality);

  if (tagged && byQuality) {
    return {
      ...clampVector({
        ...tagged,
        // The quality curve sets the baseline; tag effects scale it.
        offense: tagged.offense * byQuality.offense,
      }),
      source: 'auto:quality+tags',
    };
  }
  if (tagged) return { ...tagged, source: 'auto:tags' };
  if (byQuality) return { ...byQuality, source: 'auto:quality' };

  // No rating, no usable tag, and no scraped quality to fall back on.
  return { ...NEUTRAL, source: 'auto:neutral' };
}
