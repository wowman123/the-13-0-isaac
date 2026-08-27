/**
 * Chaos, and what it does to a roll.
 *
 * The game's own description of the item is "all item pools are combined", and
 * that is exactly the constraint this draft is built on. Every roll is a Pool x
 * Quality intersection, and the pool half is what stops a Treasure Room roll
 * from offering you the Devil Room's best item. Hold Chaos and that half stops
 * applying: the roll still lands on a quality, but every item of that quality
 * is on the table.
 *
 * It makes for the sharpest decision in the draft. Chaos itself is a Q3 item
 * that does nothing in a fight — taking it is a pick spent on nothing, paid now,
 * for a better draw on every pick that follows. Early it is close to a free
 * upgrade to the rest of the run; on the fourth pick it is one wasted slot and
 * one improved one, which is usually a loss.
 */

export const CHAOS_ID = 'COLLECTIBLE_CHAOS';

/** The pool a roll lands on once the pools are gone. */
export const ALL_POOLS = '*';

/** Is Chaos in this build? */
export const poolsCollapsed = (items) => items.some((i) => i?.id === CHAOS_ID);

/**
 * Does an item sit in the pool a roll landed on?
 *
 * With the pools collapsed the question is only whether a run can reach the
 * item at all — greed-mode pools are still a different game and stay out.
 */
export function inPool(item, pool, isRealPool) {
  const pools = item.scraped?.pools ?? [];
  return pool === ALL_POOLS ? pools.some(isRealPool) : pools.includes(pool);
}
