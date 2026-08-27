/**
 * Seeded randomness, shared by the page, the tools and the tests.
 *
 * The daily challenge needs everybody to get the same puzzle from nothing but
 * the date — there is no server here to hand one out — so the draw has to be a
 * pure function of a seed, and the seed a pure function of the day.
 */

/** Small, fast, and good enough for dealing cards. */
export function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. Turns "2026-08-27" into a seed without needing a lookup table. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The day, in UTC, as YYYY-MM-DD.
 *
 * UTC rather than local time so that two people comparing scores are comparing
 * the same puzzle. A player in Auckland and one in Los Angeles otherwise get
 * different days for most of the hours they overlap.
 */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Draw `n` distinct entries, in an order fixed by the generator. */
export function sampleWith(rng, list, n) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  }
  return out;
}

export const pickWith = (rng, list) => list[Math.floor(rng() * list.length)];
