/**
 * Item interaction.
 *
 * composeBuild treats five items as five independent multipliers, which is why
 * a draft used to be "take the biggest number". Real builds are not additive:
 * homing turns a laser from a liability into a boss-killer, a familiar booster
 * is dead weight until there is a familiar to boost, and two items that both
 * want to replace your tears mostly cancel.
 *
 * Rules live in data/synergies.json and are matched against the whole build
 * rather than against pairs, so a rule can require three of something or
 * require the absence of something.
 */

import { softCap, composeBuild } from './engine.js';

const MULTIPLICATIVE = ['offense', 'aoe', 'defense'];
const FLOORED = ['tracking', 'evasion'];

/** Every tag carried by any item in the build, with a count of how many carry it. */
export function tagCensus(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of new Set(item.tags ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/** Does this build satisfy a rule's `when` clause? */
export function matches(rule, items, census = tagCensus(items)) {
  const { tags, tagCount, withoutTags, items: needAll, anyItems } = rule.when ?? {};
  const ids = new Set(items.map((i) => i.id));

  if (tags && !tags.every((t) => census.has(t))) return false;
  if (withoutTags && withoutTags.some((t) => census.has(t))) return false;
  if (tagCount && !Object.entries(tagCount).every(([t, n]) => (census.get(t) ?? 0) >= n)) return false;
  if (needAll && !needAll.every((id) => ids.has(id))) return false;
  if (anyItems && !anyItems.some((id) => ids.has(id))) return false;

  // A rule with no predicate at all would fire on every build; treat it as a
  // data error rather than silently applying it everywhere.
  return Boolean(tags || tagCount || withoutTags || needAll || anyItems);
}

/** Which rules this build triggers, in the order they are declared. */
export function findSynergies(items, rules) {
  const census = tagCensus(items);
  return rules.filter((rule) => matches(rule, items, census));
}

/**
 * Fold triggered rules into a composed build.
 *
 * The caps are re-applied afterwards: a synergy is allowed to push a build up,
 * but not past the ceilings the composition rules already establish, or the
 * soft cap stops meaning anything.
 */
export function applySynergies(build, fired) {
  const out = { ...build };

  for (const rule of fired) {
    for (const axis of MULTIPLICATIVE) {
      if (rule.effect?.[axis] != null) out[axis] *= rule.effect[axis];
    }
    for (const axis of FLOORED) {
      if (rule.effect?.[axis] == null) continue;
      // These axes are bounded 0-1, so a rule states a level rather than a
      // scaling. Which direction depends on what the rule is: a synergy
      // guarantees a floor, a conflict imposes a ceiling. Treating both as a
      // floor silently discards every penalty, since max(x, 0) is x.
      out[axis] = rule.conflict
        ? Math.min(out[axis], rule.effect[axis])
        : Math.max(out[axis], rule.effect[axis]);
    }
  }

  out.offense = softCap(out.offense);
  out.aoe = softCap(out.aoe);
  out.defense = Math.min(out.defense, 4.0);
  out.tracking = Math.min(Math.max(out.tracking, 0), 1);
  out.evasion = Math.min(Math.max(out.evasion, 0), 1);
  return out;
}

/** How much a single rule is worth to this build, as a multiplier on offense-equivalent. */
export function synergyStrength(rule) {
  const e = rule.effect ?? {};
  const scale = (e.offense ?? 1) * (e.aoe ?? 1) * (e.defense ?? 1);
  return scale * (1 + (e.tracking ?? 0) * 0.3 + (e.evasion ?? 0) * 0.2);
}

/**
 * Transformations are the game's own three-of-a-family mechanic. The family
 * tags come from the item metadata rather than a list written here, so this
 * stays correct as the data is re-scraped.
 *
 * They are kept separate from synergy rules because they behave differently:
 * a fixed threshold, a name the player recognises, and — the part that matters
 * while drafting — meaningful partial progress. Two of a family is not a
 * synergy, but it is very much a reason to take the third.
 */
export function transformationProgress(items, spec) {
  const census = tagCensus(items);
  return spec.transformations
    .map((t) => ({ ...t, held: census.get(t.family) ?? 0, need: spec.threshold }))
    .filter((t) => t.held > 0)
    .sort((a, b) => b.held - a.held);
}

export function findTransformations(items, spec) {
  return transformationProgress(items, spec).filter((t) => t.held >= spec.threshold);
}

/**
 * The whole composition, in one call: multiply the five items together, find
 * which rules the set triggers, and fold them in.
 *
 * Both the browser and the calibration solver go through here, so a synergy
 * cannot be worth one thing on the page and another in the numbers that set
 * the difficulty.
 */
export function composeDraft(items, ratings, rules, transformations = null) {
  const fired = findSynergies(items, rules);
  const transformed = transformations ? findTransformations(items, transformations) : [];
  // Transformations fold in through the same path as synergies — they are
  // effects on the same axes, and share the same ceilings.
  const build = applySynergies(composeBuild(ratings), [...fired, ...transformed]);
  return { build, fired, transformed };
}
