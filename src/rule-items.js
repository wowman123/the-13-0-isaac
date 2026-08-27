/**
 * Items that change the rules of the draft rather than the value of a build.
 *
 * Every roll here is a Pool x Quality intersection showing six candidates, and
 * that sentence contains four separate constraints: which pool, which quality,
 * how many candidates, and that you must take one of them. A handful of items
 * in the game reach outside their own build and undo one of those, and this is
 * where they live.
 *
 * They are data rather than code because the interesting part is the list, not
 * the plumbing. Chaos was hardcoded when it was the only one, and adding a
 * second would have meant a second special case in four different places.
 *
 * All of them share a shape that makes them the sharpest picks in the draft:
 * they cost a slot now and pay only forwards, so what they are worth is almost
 * entirely a question of when they turn up.
 */

export const ALL_POOLS = '*';
export const ANY_QUALITY = -1;

/**
 * How many items a wildcard roll shows.
 *
 * Death Certificate says you choose among every item in the game, and the
 * honest version of that is a wider slate than an ordinary roll rather than the
 * same six drawn from a bigger hat.
 */
export const WILDCARD_OFFER = 12;

/** Kept for the one caller that only cares about Chaos by name. */
export const CHAOS_ID = 'COLLECTIBLE_CHAOS';

/**
 * What a build's rule items add up to.
 *
 * `spec` is data/rule-items.json. Effects accumulate — two pedestal items give
 * you both — because that is how they behave in the game, and because a rule
 * that silently ignored the second copy would be a worse surprise than a strong
 * one.
 */
export function activeRules(items, spec) {
  const held = new Set(items.map((i) => i?.id).filter(Boolean));
  const rules = {
    combinePools: false,
    minQuality: 0,
    extraRolls: 0,
    offerRerolls: 0,
    wildcards: 0,
    active: [],
  };
  if (!spec?.items) return rules;

  for (const rule of spec.items) {
    if (!held.has(rule.id)) continue;
    rules.active.push(rule);

    switch (rule.effect) {
      case 'combinePools': rules.combinePools = true; break;
      case 'minQuality': rules.minQuality = Math.max(rules.minQuality, rule.value ?? 0); break;
      case 'extraRolls': rules.extraRolls += rule.value ?? 0; break;
      case 'offerRerolls': rules.offerRerolls += rule.value ?? 0; break;
      case 'wildcard': rules.wildcards += rule.value ?? 0; break;
      default: break;
    }
  }
  return rules;
}

/** Is this item reachable on a roll that landed here? */
export function inPool(item, pool, isRealPool) {
  const pools = item.scraped?.pools ?? [];
  // Greed mode is a different game and stays out however the pools are bent.
  return pool === ALL_POOLS ? pools.some(isRealPool) : pools.includes(pool);
}

/** Which qualities a roll may still land on. */
export const qualities = (rules) =>
  [0, 1, 2, 3, 4].filter((q) => q >= (rules.minQuality ?? 0));

/** Every id that changes a rule, for the places that need to know. */
export const ruleItemIds = (spec) => new Set((spec?.items ?? []).map((r) => r.id));
