/**
 * The daily challenge.
 *
 * One puzzle a day, the same one for everybody, built from the date alone. The
 * site is a static page with no server, so there is nothing to hand out a
 * puzzle — it has to be derivable, and it is: the day seeds a generator, the
 * generator deals the rounds.
 *
 * Two rules make a daily run comparable in a way an ordinary one is not.
 *
 * All five rounds are dealt up front, before a single pick. In free play the
 * next roll is drawn after you choose, so two players who pick differently see
 * different offers from round two onward and are no longer answering the same
 * question. Here everyone sees the same thirty items in the same five groups,
 * and the only thing that varies is what they take.
 *
 * And there are no respins. A respin is a fresh draw, which would put two
 * players back on different puzzles immediately. The daily asks a narrower
 * question than free play does — given exactly these five offers, what is the
 * best build you can make — and that question has one answer everybody is
 * chasing.
 */

import { mulberry32, hashString, dayKey, sampleWith, pickWith } from './random.js';
import { ruleItemIds } from './rule-items.js';

/**
 * The ids a daily must not offer, when no spec is passed.
 *
 * Kept as a literal rather than read from disk because this module is loaded by
 * the page, the tools and the tests, and only one of those can read a file. The
 * test suite asserts it matches data/rule-items.json, so it cannot drift.
 */
export const DEFAULT_RULE_SPEC = {
  items: [
    { id: 'COLLECTIBLE_CHAOS' },
    { id: 'COLLECTIBLE_SACRED_ORB' },
    { id: 'COLLECTIBLE_MORE_OPTIONS' },
    { id: 'COLLECTIBLE_THERES_OPTIONS' },
    { id: 'COLLECTIBLE_D6' },
    { id: 'COLLECTIBLE_DEATH_CERTIFICATE' },
  ],
};

export const DAILY_ROUNDS = 5;
export const DAILY_OFFER = 6;

/**
 * A daily round has to be a decision. Free play rolls uniformly over every
 * intersection that holds anything, thin ones included, and a round offering
 * one item is a fine bit of texture there — the game says so out loud. As the
 * whole of one fifth of a fixed puzzle everybody is compared on, it is just a
 * round nobody gets to play. So the daily draws only from cells with at least
 * this many items, and falls back to the fullest ones if a day somehow runs
 * short.
 */
const MIN_DAILY_CHOICES = 4;

/** The seed for a given day. Exported so a test can pin one. */
export const seedForDay = (day = dayKey()) => hashString(`the-13-0:${day}`);

/**
 * Deal one day's puzzle.
 *
 * `items` is the draftable pool. Cells are rebuilt per round from what is left,
 * so no item is ever offered twice across the five rounds — a duplicate would
 * be a dead option, and worse, a different number of real choices for whoever
 * happened to take it early.
 */
export function buildDaily(items, day = dayKey(), ruleSpec = null) {
  const RULE_ITEMS = ruleItemIds(ruleSpec ?? DEFAULT_RULE_SPEC);
  const rng = mulberry32(seedForDay(day));
  const isRealPool = (p) => !p.startsWith('greed');

  let remaining = items.filter(
    (i) => i.scraped?.quality != null
      && (i.scraped?.pools ?? []).some(isRealPool)
      // Every rule item changes the rolls that come after it, and a daily has
      // none — all five are dealt before the first pick, so that everybody
      // answers the same question. Offering an item whose whole effect a daily
      // cannot honour would be worse than leaving it out, so they are left out.
      && !RULE_ITEMS.has(i.id),
  );
  const pools = [...new Set(remaining.flatMap((i) => i.scraped.pools.filter(isRealPool)))].sort();

  const rounds = [];
  for (let round = 0; round < DAILY_ROUNDS; round++) {
    // Only intersections that still hold something, so a round is never empty.
    const cells = [];
    for (const pool of pools) {
      for (let quality = 0; quality <= 4; quality++) {
        const inCell = remaining.filter(
          (i) => i.scraped.quality === quality && i.scraped.pools.includes(pool),
        );
        if (inCell.length) cells.push({ pool, quality, inCell });
      }
    }
    if (!cells.length) break;

    const roomy = cells.filter((c) => c.inCell.length >= MIN_DAILY_CHOICES);
    const from = roomy.length ? roomy : cells;
    const { pool, quality, inCell } = pickWith(rng, from);
    const offer = sampleWith(rng, inCell, DAILY_OFFER);
    const offered = new Set(offer.map((i) => i.id));
    remaining = remaining.filter((i) => !offered.has(i.id));

    rounds.push({ pool, quality, candidates: offer.map((i) => i.id) });
  }

  return { day, seed: seedForDay(day), rounds };
}

/**
 * A spoiler-free summary of a finished daily, for sharing.
 *
 * It reports the shape of the run — which quality of item you took each round,
 * and what it came to — without naming anything, so posting it does not hand
 * the answer to somebody who has not played yet.
 */
const QUALITY_BLOCK = ['⬜', '🟦', '🟩', '🟨', '🟥'];

export function shareText(day, picks, total, site = '', par = null) {
  const blocks = picks.map((q) => QUALITY_BLOCK[Math.max(0, Math.min(4, q))]).join('');
  const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(2)}%`);

  // The score alone says little without the ceiling it was measured against —
  // 24% is dreadful on a deal that allowed 54% and excellent on one that
  // allowed 25%. Neither number names an item, so neither spoils anything.
  const line = par
    ? `${pct(total)} of a possible ${pct(par.best)} — beat ${(par.beat * 100).toFixed(0)}% of builds`
    : `${pct(total)} chance of a 13-0`;

  return [`The 13-0 — ${day}`, blocks, line, site].filter(Boolean).join('\n');
}
