#!/usr/bin/env node
/**
 * Build data/scraped.json from a Binding of Isaac resource directory.
 *
 *   node tools/scrape.mjs "/path/to/The Binding of Isaac Rebirth/resources"
 *
 * Nothing here is typed from memory. If a field is not in the XML it comes out
 * null, not guessed. Parsing lives in src/scrape-parse.js so it stays testable.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseResources } from '../src/scrape-parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resources = process.argv[2];

if (!resources) {
  console.error('usage: node tools/scrape.mjs <path-to-isaac-resources-dir>');
  console.error('  expects <dir>/items.xml and <dir>/itempools.xml');
  process.exit(2);
}

const itemsPath = join(resources, 'items.xml');
const poolsPath = join(resources, 'itempools.xml');
// Quality lives here in Repentance dumps, not in items.xml.
const metaPath = join(resources, 'items_metadata.xml');
for (const p of [itemsPath, poolsPath]) {
  if (!existsSync(p)) {
    console.error(`scrape: ${p} not found`);
    process.exit(2);
  }
}

const handIds = readFileSync(join(root, 'data/ratings.psv'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('COLLECTIBLE_'))
  .map((l) => l.split('|')[0].trim());

const overridesPath = join(root, 'data/id-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};

const { scraped, matched, unmatched, poolCount, metaCount } = parseResources(
  readFileSync(itemsPath, 'utf8'),
  readFileSync(poolsPath, 'utf8'),
  handIds,
  overrides,
  existsSync(metaPath) ? readFileSync(metaPath, 'utf8') : '',
);

if (!existsSync(metaPath)) {
  console.warn(`scrape: no items_metadata.xml beside items.xml — quality will be null`);
}

// Record where this came from, not the absolute path it happened to be read
// from — that is machine-specific noise in a committed file.
const provenance = resources.split(/[\\/]/).filter(Boolean).slice(-3).join('/');

writeFileSync(
  join(root, 'data/scraped.json'),
  `${JSON.stringify({
    source: `Binding of Isaac resource files (${provenance})`,
    scrapedAt: new Date().toISOString().slice(0, 10),
    items: scraped,
  }, null, 2)}\n`,
);

const withQuality = scraped.filter((s) => s.quality != null).length;
console.log(`scrape: ${scraped.length} items from items.xml, ${poolCount} with pool entries`);
console.log(`  ${metaCount} metadata rows, ${withQuality} items with a quality`);
console.log(`  matched ${matched.length}/${handIds.length} hand-rated items by name`);
if (unmatched.length) {
  console.log(`  ${unmatched.length} hand-rated id(s) had no XML match — map them in data/id-overrides.json`);
  console.log('  (keys are the XML display name, values are the COLLECTIBLE_ id)');
  for (const id of unmatched.slice(0, 20)) console.log(`    ${id}`);
  if (unmatched.length > 20) console.log(`    ... and ${unmatched.length - 20} more`);
}
console.log('  now run: node tools/build-items.mjs');
