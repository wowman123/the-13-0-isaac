#!/usr/bin/env node
/**
 * Real per-item stat deltas, for Advanced mode.
 *
 * Casual mode rates an item on five abstract axes that were assigned by hand or
 * inferred from tags. Advanced mode does not abstract: it runs the game's own
 * stat formulas, so it needs the actual numbers an item adds — +0.7 Tears, a
 * x1.5 damage multiplier — which the game's XML does not carry. `cache` names
 * which stats an item touches and never by how much.
 *
 * Those numbers come from RebirthItemTracker, which is BSD-2-Clause and is
 * therefore redistributable with its notice kept; see NOTICE.md. Its keys are
 * the collectible ids the game uses, which is also what `xmlId` holds here, so
 * the two line up exactly with no name matching involved.
 *
 * Writes data/item-stats.json. Run it only when the upstream data changes.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://raw.githubusercontent.com/Rchardon/RebirthItemTracker/master/items_rep.json';

/** The fields worth carrying. Everything else there is tracker bookkeeping. */
const NUMERIC = ['dmg', 'dmg_x', 'tears', 'tears_x', 'range', 'speed', 'shot_speed', 'luck', 'health', 'soul_hearts'];

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`scrape-stats: ${SOURCE} returned ${res.status}`);
  process.exit(1);
}
const upstream = await res.json();

const scraped = JSON.parse(readFileSync(join(root, 'data/scraped.json'), 'utf8')).items;
const byXmlId = new Map(scraped.filter((s) => s.xmlId).map((s) => [s.xmlId, s]));

const stats = {};
const names = {};
let withStats = 0;
let unmatched = 0;

for (const [key, entry] of Object.entries(upstream)) {
  if (!/^\d+$/.test(key) || typeof entry !== 'object' || entry === null) continue;
  const mine = byXmlId.get(Number(key));
  if (!mine) { unmatched += 1; continue; }

  // The tracker's display names carry the punctuation a localisation key cannot
  // hold — "Dr. Fetus", "20/20", "Cat-o-nine-tails" — so they are worth taking
  // wholesale rather than correcting by hand, one name at a time.
  if (typeof entry.name === 'string' && entry.name.trim()) names[mine.id] = entry.name.trim();

  const row = {};
  for (const field of NUMERIC) {
    const v = Number(entry[field]);
    if (Number.isFinite(v) && v !== 0) row[field] = v;
  }
  if (Object.keys(row).length) { stats[mine.id] = row; withStats += 1; }
}

writeFileSync(
  join(root, 'data/item-stats.json'),
  `${JSON.stringify({
    source: 'RebirthItemTracker items_rep.json (BSD-2-Clause) — numeric stat deltas and display names only',
    fields: NUMERIC,
    names,
    stats,
  }, null, 2)}\n`,
);

console.log(`scrape-stats: ${Object.keys(names).length} names, ${withStats} items carry stat deltas`);
if (unmatched) console.log(`  ${unmatched} upstream ids matched nothing here (trinkets, cards, pills)`);
