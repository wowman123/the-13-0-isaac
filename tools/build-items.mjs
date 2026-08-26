#!/usr/bin/env node
/**
 * data/ratings.psv  (hand layer)   ─┐
 *                                   ├─> data/items.json
 * data/scraped.json (scrape layer) ─┘
 *
 * The scrape layer is optional. When it is absent every record gets
 * `scraped: null` rather than invented numbers — that is the whole point of
 * splitting the two layers in the first place.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AXIS_RANGE } from '../src/ratings.js';
import { humanise, recase } from '../src/scrape-parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const AXES = ['offense', 'aoe', 'tracking', 'defense', 'evasion'];

function parseRatings(text) {
  const items = [];
  const errors = [];

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.split('|');
    const where = `ratings.psv:${i + 1}`;
    if (parts.length !== 9) {
      errors.push(`${where}: expected 9 fields, got ${parts.length}`);
      return;
    }

    const [id, name, ...rest] = parts;
    const [note] = rest.slice(-1);
    const tags = rest[5].split(',').map((t) => t.trim()).filter((t) => t && t !== 'none');
    const rated = { source: 'hand', note: note.trim() };

    AXES.forEach((axis, a) => {
      const value = Number(rest[a]);
      const [lo, hi] = AXIS_RANGE[axis];
      if (!Number.isFinite(value)) errors.push(`${where}: ${axis} "${rest[a]}" is not a number`);
      else if (value < lo || value > hi) errors.push(`${where}: ${axis} ${value} outside ${lo}-${hi}`);
      rated[axis] = value;
    });

    if (!tags.length) errors.push(`${where}: ${id} has no tags`);
    items.push({ id: id.trim(), name: name.trim(), scraped: null, rated, tags });
  });

  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`duplicate id ${item.id}`);
    seen.add(item.id);
  }

  return { items, errors };
}

const { items, errors } = parseRatings(readFileSync(join(root, 'data/ratings.psv'), 'utf8'));

if (errors.length) {
  console.error(`build-items: ${errors.length} problem(s) in the hand layer\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

// Merge the scrape layer over the top if it has been generated.
const scrapedPath = join(root, 'data/scraped.json');
// A few display names cannot be recovered from the localisation key — an
// apostrophe or a decimal point is simply not in it. Keyed by the raw key so a
// re-scrape keeps working.
// RebirthItemTracker's display names carry the punctuation a localisation key
// cannot hold, for nearly the whole pool at once. The hand list below then has
// the final say, for the few it does not cover.
const statsPath = join(root, 'data/item-stats.json');
const trackerNames = existsSync(statsPath)
  ? (JSON.parse(readFileSync(statsPath, 'utf8')).names ?? {})
  : {};

const namesPath = join(root, 'data/name-overrides.json');
const nameOverrides = existsSync(namesPath)
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(namesPath, 'utf8')))
      .filter(([k]) => !k.startsWith('_')))
  : {};
const unusedNames = new Set(Object.keys(nameOverrides));

let merged = 0;
if (existsSync(scrapedPath)) {
  const scraped = JSON.parse(readFileSync(scrapedPath, 'utf8'));
  for (const s of scraped.items) {
    // Re-derive from the raw localisation key rather than trusting the name the
    // scrape happened to write. The key is the source of truth, so improving
    // humanise() reaches the committed data without needing a re-scrape.
    if (s.xmlName) s.name = humanise(s.xmlName);
    // The tracker is authoritative on punctuation, not on title case: it
    // writes "Contract From Below" where the game writes "from".
    if (trackerNames[s.id]) s.name = recase(trackerNames[s.id]);
    const better = nameOverrides[s.xmlName];
    if (better) { s.name = better; unusedNames.delete(s.xmlName); }
  }
  const byId = new Map(scraped.items.map((s) => [s.id, s]));

  for (const item of items) {
    const s = byId.get(item.id);
    if (!s) continue;
    if (nameOverrides[s.xmlName] || trackerNames[s.id]) item.name = s.name;
    item.scraped = { quality: s.quality, pools: s.pools, type: s.type, stats: s.stats };
    merged++;
    byId.delete(item.id);
  }

  // Anything in the XML we have not hand-rated still ships, on tag/quality defaults.
  for (const s of byId.values()) {
    items.push({
      id: s.id,
      name: s.name,
      scraped: { quality: s.quality, pools: s.pools, type: s.type, stats: s.stats },
      rated: null,
      tags: s.tags ?? [],
    });
  }
}

items.sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(
  join(root, 'data/items.json'),
  // No build timestamp here on purpose. The output must be reproducible from
  // its inputs alone, or CI's "generated files are current" check compares a
  // fresh build against a committed one and fails on any day but the commit
  // day. Git already records when this was generated.
  `${JSON.stringify({ scrapeLayer: existsSync(scrapedPath), items }, null, 2)}\n`,
);

// A stale override is a silent lie about the data, so say so rather than
// letting it sit in the file forever.
if (unusedNames.size) {
  console.error(`build-items: ${unusedNames.size} name override(s) matched nothing: ${[...unusedNames].join(', ')}`);
  process.exit(1);
}

console.log(`build-items: ${items.length} items written`);
console.log(
  existsSync(scrapedPath)
    ? `  scrape layer merged into ${merged}, ${items.length - merged} auto-rated from XML only`
    : '  no data/scraped.json — every record has scraped: null (run tools/scrape.mjs)',
);
