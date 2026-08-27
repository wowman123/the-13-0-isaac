/**
 * What each item pool is called on screen.
 *
 * Its own module because the draft, the item browser and the tests all name
 * pools, and a pool the map has never heard of used to fall back to a
 * title-cased id — which is how "Woodenchest" and "Batterybum" reached the
 * page. A test now asserts every pool in the item data has a name here, so the
 * next pool the data gains fails the suite rather than the eye.
 */

export const POOL_LABELS = {
  treasure: 'Treasure Room',
  shop: 'Shop',
  boss: 'Boss Room',
  devil: 'Devil Room',
  angel: 'Angel Room',
  secret: 'Secret Room',
  ultrasecret: 'Ultra Secret Room',
  curse: 'Curse Room',
  library: 'Library',
  cranegame: 'Crane Game',
  beggar: 'Beggar',
  demonbeggar: 'Devil Beggar',
  rottenbeggar: 'Rotten Beggar',
  goldenchest: 'Golden Chest',
  redchest: 'Red Chest',
  oldchest: 'Old Chest',
  woodenchest: 'Wooden Chest',
  bombbum: 'Bomb Bum',
  babyshop: 'Baby Shop',
  planetarium: 'Planetarium',
  momschest: "Mom's Chest",
  batterybum: 'Battery Bum',
  keymaster: 'Key Master',
  shellgame: 'Shell Game',
};

export const poolLabel = (pool, allPools) => (pool === allPools
  ? 'All pools'
  : POOL_LABELS[pool] ?? pool.replace(/^\w/, (c) => c.toUpperCase()));
