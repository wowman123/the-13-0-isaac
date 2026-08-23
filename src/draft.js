/**
 * How a roll answers the build in front of it.
 *
 * A transformation costs three of five picks, and the pool a roll draws from is
 * one Pool x Quality cell out of roughly a hundred. Left to chance, a player
 * who deliberately chases a family finishes it about four percent of the time —
 * so the payout never actually happens, however generous it is. That is a
 * lottery, not a decision.
 *
 * The fix is not a bigger payout, it is reachability. Once you are holding two
 * of a family you have committed a pick you would not otherwise have spent, and
 * the run answers that commitment: the roll leans toward somewhere the third
 * item lives, and the item is guaranteed a seat in the six. Two of a family is
 * almost never an accident, so a player who is not chasing anything sees this
 * on roughly a fifth of one roll per run — it costs them nothing.
 *
 * These helpers are pure and take the cell lookup as an argument, so the page
 * and the simulations that set the difficulty run the same rule.
 */

import { tagCensus } from './synergy.js';

/** Families the build is exactly one pick short of completing. */
export function pendingFamilies(items, spec) {
  if (!spec) return [];
  const census = tagCensus(items);
  return spec.transformations
    .filter((t) => (census.get(t.family) ?? 0) === spec.threshold - 1)
    .map((t) => t.family);
}

/** True if this item would finish one of those families. */
export const completes = (item, families) =>
  families.length > 0 && (item.tags ?? []).some((t) => families.includes(t));

/**
 * Narrow the viable cells to those a pending family can actually be finished
 * in. Returns the full list unchanged when nothing is pending or nothing is
 * reachable, so the caller can always roll over the result.
 */
export function leaningCells(cells, families, itemsIn) {
  if (!families.length) return cells;
  const hot = cells.filter((c) => itemsIn(c).some((i) => completes(i, families)));
  return hot.length ? hot : cells;
}

/**
 * Put a completing item in the offer if the cell has one and the draw missed
 * it. Replaces the last slot rather than adding a seventh, so the promise that
 * a roll shows six stays true. Returns the id of the pulled item, or null.
 */
export function pullCompletion(offer, cellItems, families, pickRandom) {
  if (!families.length || offer.some((i) => completes(i, families))) return null;
  const candidates = cellItems.filter((i) => completes(i, families) && !offer.includes(i));
  if (!candidates.length) return null;
  const pulled = pickRandom(candidates);
  offer[offer.length - 1] = pulled;
  return pulled.id;
}
