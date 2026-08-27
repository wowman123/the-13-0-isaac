/**
 * How well you played today's puzzle, not just how you scored.
 *
 * A daily deals five fixed offers, so unlike free play it has an exact best
 * answer — and without one, a score means very little. 24% sounds respectable
 * and is dreadful if the deal allowed 54%; 12% sounds poor and is close to
 * perfect if 13% was the ceiling. The number a player actually wants is where
 * their build sat between the worst and best builds available to them.
 *
 * This is only possible because a daily fixes all five offers up front. Free
 * play redraws after every pick, so its tree is the whole item pool deep and
 * there is nothing to exhaust. A daily is at most six to the fifth — a few
 * thousand builds — which is a hundred milliseconds of brute force rather than
 * a search that might miss the answer.
 */

import { composeDraft } from './synergy.js';
import { runOdds } from './engine.js';

/**
 * Every build the deal allows, reduced to the best and the worst.
 *
 * `rounds` is the daily's dealt rounds; `resolve` turns an item id into its
 * rating, which differs between modes and so is passed in rather than assumed.
 */
export function parForDeal(rounds, byId, resolve, bosses, config, rules, transformations) {
  const offers = rounds.map((r) => r.candidates.map(byId).filter(Boolean));
  if (offers.some((o) => !o.length)) return null;

  let best = { total: -1, picks: [] };
  let worst = { total: 2, picks: [] };
  const totals = [];

  const walk = (depth, picked) => {
    if (depth === offers.length) {
      const { build } = composeDraft(picked, picked.map(resolve), rules, transformations);
      const total = runOdds(build, bosses, config).total;
      totals.push(total);
      if (total > best.total) best = { total, picks: picked.map((i) => i.id) };
      if (total < worst.total) worst = { total, picks: picked.map((i) => i.id) };
      return;
    }
    for (const candidate of offers[depth]) {
      picked.push(candidate);
      walk(depth + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);

  totals.sort((a, b) => a - b);
  return { best, worst, count: totals.length, totals };
}

/**
 * The share of possible builds this one beat.
 *
 * Interpolating between the deal's floor and ceiling was the first attempt and
 * it flattered everybody: the worst build in a deal is often a thousandth of a
 * percent, so anchoring there made scoring 2% out of a possible 54% read as
 * "the better half". A percentile needs no scale chosen for it and answers the
 * question directly — of everything you could have drafted, how much of it did
 * you beat.
 */
export function parScore(total, totals) {
  if (!totals?.length) return 1;
  let below = 0;
  // Sorted ascending, so this is a binary search for where the score lands.
  let lo = 0;
  let hi = totals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (totals[mid] < total) lo = mid + 1;
    else hi = mid;
  }
  below = lo;
  return below / totals.length;
}

/** What to call a result, so the number has a word attached to it. */
export function parGrade(fraction, isBest = false) {
  if (isBest) return 'the best build the deal allowed';
  if (fraction >= 0.99) return 'a near-perfect read of the deal';
  if (fraction >= 0.9) return 'a strong draft';
  if (fraction >= 0.7) return 'a good draft';
  if (fraction >= 0.4) return 'middling — there was more here';
  if (fraction >= 0.15) return 'the deal had a lot more to give';
  return 'almost everything else was better';
}
