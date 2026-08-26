#!/usr/bin/env node
/**
 * Starting stats for every character, for Advanced mode.
 *
 * Two sources, because no single one has all of it.
 *
 * Health, and whether a character fires tears at all, come from the game's own
 * players.xml, mirrored at Derugon/TBoIR-resources. That file is authoritative
 * and machine-readable: `hp` is red half-hearts, `armor` is soul half-hearts,
 * `black` is black half-hearts, and `canShoot="false"` marks a character who
 * has no tears to speak of.
 *
 * The combat multipliers are not in any XML — damage, tears, range, shot speed,
 * speed and luck are compiled into the game — so they are transcribed below
 * from the wiki's attribute table. The header there names 17 characters while
 * the rows carry 21 values, because four characters are listed as both of their
 * forms; COLUMNS spells that reading out so it can be checked rather than
 * trusted.
 *
 * Writes data/characters.json. Run only when the upstream data changes.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS_XML = 'https://raw.githubusercontent.com/Derugon/TBoIR-resources/latest/resources/players.xml';

/** The wiki table's column order, once the split forms are expanded. */
const COLUMNS = [
  'Isaac', 'Magdalene', 'Cain', 'Judas', 'Dark Judas', '???', 'Eve', 'Samson',
  'Azazel', 'Lazarus', 'Lazarus Risen', 'Eden', 'The Lost', 'Lilith', 'Keeper',
  'Apollyon', 'The Forgotten', 'The Soul', 'Bethany', 'Jacob', 'Esau',
];

const TABLE = {
  damageMult: [1.00, 1.00, 1.20, 1.35, 2.00, 1.05, 0.75, 1.00, 1.50, 1.00, 1.40, 1.00, 1.00, 1.00, 1.20, 1.00, 1.50, 1.00, 1.00, 1.00, 1.00],
  damage:     [3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 2.75, 3.75],
  tears:      [0, 0, 0, 0, 0, 0, 0, -0.1, 0.5, 0, 0, 0, 0, 0, -1.9, 0, 0, 0, 0, 0.277, -0.1],
  tearsMult:  [1, 1, 1, 1, 1, 1, 1, 1, 0.267, 1, 1, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 1],
  speed:      [1.0, 0.85, 1.3, 1.0, 1.1, 1.1, 1.23, 1.1, 1.25, 1.0, 1.25, 1.0, 1.0, 1.0, 0.9, 1.0, 1.0, 1.3, 1.0, 1.0, 1.0],
  shotSpeed:  [1, 1, 1, 1, 1, 1, 1, 1.31, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.15, 0.85],
  range:      [6.5, 6.5, 4.5, 6.5, 6.5, 6.5, 6.5, 5.0, 4.5, 4.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 5, 8],
};

/**
 * Luck is 0 for all but a few, and the table's luck row is one value short of
 * its own column count — so only the entries that can be pinned to a character
 * with certainty are taken, and the rest stay at zero. Guessing which column
 * lost its value would put a wrong number in the file to fill a gap nobody
 * would notice.
 */
const LUCK = { Keeper: -2, Jacob: 1, Esau: -1 };

/**
 * Ids for the page and the saved preference. Mostly derivable from the name,
 * except "???", whose name is entirely punctuation; the game calls it Blue Baby
 * internally and so does this.
 */
const IDS = { '???': 'BLUE_BABY' };

/** Which players.xml entry each column is, by the game's own player id. */
const PLAYER_ID = {
  Isaac: 0, Magdalene: 1, Cain: 2, Judas: 3, '???': 4, Eve: 5, Samson: 6,
  Azazel: 7, Lazarus: 8, 'The Lost': 10, 'Lazarus Risen': 11, 'Dark Judas': 12,
  Lilith: 13, Keeper: 14, Apollyon: 15, 'The Forgotten': 16, 'The Soul': 17,
  Bethany: 18, Jacob: 19, Esau: 20,
};

/**
 * Where damage x fire rate stops describing a character. The stat line is still
 * real, but the DPS built from it is not what that character actually does, and
 * saying so is better than printing a confident wrong number.
 */
const CAVEATS = {
  Azazel: 'Brimstone is a continuous beam rather than tears, so the stats are real but the DPS built from them is an approximation.',
  Lilith: 'Fires no tears at all — Incubus does the shooting. The DPS here describes an attack she does not have.',
  'The Forgotten': 'Swings a bone club. His tear stats exist but most of his damage is melee, which this does not model.',
  'The Soul': 'Fights with a chain rather than tears.',
  Eden: 'Every stat is randomised at the start of a run. These are the midpoints, not what you would actually get.',
  'The Lost': 'Dies to a single hit. The health here is accurate and still understates how sharp that is.',
  Keeper: 'Health is coin hearts, which behave differently from the containers this model counts.',
};

const NOTES = {
  Isaac: 'The baseline. 3.5 damage, 10 frames between tears, 2.73 tears a second.',
  Magdalene: 'The most health in the game and the slowest legs to carry it.',
  Cain: 'Fast, hits harder, sees less of the room — the shortest range of the starting three.',
  Judas: 'A third more damage for a single heart container.',
  'Dark Judas': 'Double damage, four black hearts, and nothing else to lose.',
  '???': 'Six soul hearts and no containers, so nothing heals you.',
  Eve: 'Starts at three quarters damage. Whore of Babylon lifts her back at low health, which this does not simulate.',
  Samson: 'Slightly slower tears that travel faster, and all three hearts kept.',
  Azazel: 'Half again the damage, six black hearts, and a fraction of the fire rate.',
  Lazarus: 'Ordinary until he dies, at which point he gets stronger.',
  'Lazarus Risen': 'The second life: more damage and quicker feet than the man who died.',
  Eden: 'Rolled at random, every run.',
  'The Lost': 'One hit. Everything else about the build is academic.',
  Lilith: 'Blindfolded. Her familiar is the whole offence.',
  Keeper: 'Coin hearts, a heavy tear penalty and the worst luck in the game.',
  Apollyon: 'Isaac with a Void. The stats are plain; the item is not.',
  'The Forgotten': 'Half again the damage, halved fire rate, and a club instead of tears.',
  'The Soul': 'The other half of the Forgotten, quick and fragile.',
  Bethany: 'Three containers plus soul charges, at ordinary stats.',
  Jacob: 'Lower base damage than anyone, but the fastest tears and good luck.',
  Esau: 'The highest base damage in the game, on the longest range, tied to a brother who is not.',
};

const res = await fetch(PLAYERS_XML);
if (!res.ok) {
  console.error(`scrape-characters: ${PLAYERS_XML} returned ${res.status}`);
  process.exit(1);
}
const xml = await res.text();

/** hp/armor/black are half-hearts; a container is two of them. */
const players = new Map();
for (const tag of xml.match(/<player\b[^>]*?\/>/gs) ?? []) {
  const attr = (k) => tag.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
  const id = Number(attr('id'));
  if (!Number.isFinite(id)) continue;
  players.set(id, {
    hp: Number(attr('hp') ?? 0),
    armor: Number(attr('armor') ?? 0),
    black: Number(attr('black') ?? 0),
    canShoot: attr('canShoot') !== 'false',
  });
}

const characters = COLUMNS.map((name, i) => {
  const player = players.get(PLAYER_ID[name]) ?? {};
  const stats = {};

  // Only record what differs from Isaac; the engine fills the rest in.
  const put = (key, value, base) => { if (value !== base) stats[key] = value; };
  put('damage', TABLE.damage[i], 3.5);
  put('damageMult', TABLE.damageMult[i], 1);
  put('tears', TABLE.tears[i], 0);
  put('tearsMult', TABLE.tearsMult[i], 1);
  put('speed', TABLE.speed[i], 1);
  put('shotSpeed', TABLE.shotSpeed[i], 1);
  put('range', TABLE.range[i], 6.5);
  put('luck', LUCK[name] ?? 0, 0);
  put('health', (player.hp ?? 6) / 2, 3);
  put('soulHearts', (player.armor ?? 0) + (player.black ?? 0), 0);

  return {
    id: IDS[name] ?? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name,
    tainted: false,
    stats,
    note: NOTES[name] ?? '',
    ...(CAVEATS[name] ? { caveat: CAVEATS[name] } : {}),
    ...(player.canShoot === false ? { firesTears: false } : {}),
  };
});

writeFileSync(
  join(root, 'data/characters.json'),
  `${JSON.stringify({
    note: "Starting stats for Advanced mode. Health and whether a character fires tears come from the game's own players.xml; the combat multipliers are compiled into the game rather than shipped as data, so they are transcribed from the wiki's attribute table — see tools/scrape-characters.mjs, which spells out how that table's columns line up. A character whose attack is not tears carries a caveat rather than a confident DPS number that would be wrong.",
    source: 'players.xml via Derugon/TBoIR-resources (health, canShoot) + wiki attribute table (combat multipliers)',
    characters,
  }, null, 2)}\n`,
);

console.log(`scrape-characters: ${characters.length} characters`);
console.log(`  ${characters.filter((c) => c.caveat).length} carry a caveat about how they actually fight`);
