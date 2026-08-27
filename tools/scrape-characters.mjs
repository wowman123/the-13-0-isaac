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
  Azazel: 7, Lazarus: 8, Eden: 9, 'The Lost': 10, 'Lazarus Risen': 11, 'Dark Judas': 12,
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


/**
 * The tainted roster, from the same wiki's tainted attribute table. Its header
 * names seventeen characters and its rows carry nineteen values, because the
 * Forgotten pair and the Lazarus pair are each listed as both of their forms.
 *
 * A dash in that table means "not this half of the pair" rather than a missing
 * value, and it lands in a different column in different rows: Tainted
 * Forgotten carries the damage and tear stats with no speed of its own, and
 * Tainted Soul carries the speed with no tear stats at all. Every row has
 * nineteen entries under that reading, which is the check that it is the right
 * one — and the regular table splits the same pair the same way.
 */
const TAINTED_COLUMNS = [
  'Tainted Isaac', 'Tainted Magdalene', 'Tainted Cain', 'Tainted Judas',
  'Tainted ???', 'Tainted Eve', 'Tainted Samson', 'Tainted Azazel',
  'Tainted Lazarus', 'Dead Tainted Lazarus', 'Tainted Eden', 'Tainted Lost',
  'Tainted Lilith', 'Tainted Keeper', 'Tainted Apollyon', 'Tainted Forgotten',
  'Tainted Soul', 'Tainted Bethany', 'Tainted Jacob',
];

/** null is the table's dash: not applicable to this half of the pair. */
const N = null;
const TAINTED_TABLE = {
  damageMult: [1.00, 0.75, 1.20, 1.00, 1.00, 1.20, 1.00, 1.50, 1.00, 1.50, 1.00, 1.30, 1.00, 1.00, 1.00, 1.50, N, 1.00, 1.00],
  damage:     [3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, 3.50, N, 3.50, 3.50],
  tears:      [0, 0, 0, 0, -0.35, -0.5, -0.1, 0, 0, -0.1, 0, 0, 0, -2.2, -0.5, 0, N, 0, 0.277],
  tearsMult:  [1, 1, 1, 1, 1, 0.66, 1, 1 / 3, 1, 1, 1, 1, 1, 1, 1, 0.5, N, 1, 1],
  shotSpeed:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, N, 1, 1],
  range:      [6.5, 6.5, 4.5, 4.5, 6.5, 6.5, 5, 6.5, 4.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, N, 6.5, 6.5],
  speed:      [1.0, 1.0, 1.3, 1.23, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 1.0, 1.0, 0.85, 1.0, 1.0, N, 1.0, 1.0, 1.0],
};

/**
 * Same policy as the regular table, whose luck row is also one value short of
 * its own column count: only the entry that can be pinned with certainty is
 * taken, and Tainted Keeper's -2 matches Keeper's.
 */
const TAINTED_LUCK = { 'Tainted Keeper': -2 };

const TAINTED_PLAYER_ID = {
  'Tainted Isaac': 21, 'Tainted Magdalene': 22, 'Tainted Cain': 23, 'Tainted Judas': 24,
  'Tainted ???': 25, 'Tainted Eve': 26, 'Tainted Samson': 27, 'Tainted Azazel': 28,
  'Tainted Lazarus': 29, 'Tainted Eden': 30, 'Tainted Lost': 31, 'Tainted Lilith': 32,
  'Tainted Keeper': 33, 'Tainted Apollyon': 34, 'Tainted Forgotten': 35,
  'Tainted Bethany': 36, 'Tainted Jacob': 37, 'Dead Tainted Lazarus': 38, 'Tainted Soul': 40,
};

const TAINTED_IDS = { 'Tainted ???': 'TAINTED_BLUE_BABY' };

const TAINTED_CAVEATS = {
  'Tainted Azazel': "A short Brimstone beam at a third of Isaac's fire rate. The stats are real; the DPS built from them is an approximation.",
  'Tainted Lilith': 'Fights through a demonic baby rather than any tears of her own.',
  'Tainted Forgotten': 'Swings a bone club, and has no speed of its own — the Soul moves the pair.',
  'Tainted Soul': 'Fights with a chain and has no tear stats at all. Only her speed and health are real numbers here.',
  'Tainted Eden': 'Every stat is rolled at the start of a run, health included. These are the midpoints, not what you would get.',
  'Tainted Lost': 'Dies to a single hit, with the damage bonus meant to make up for it.',
  'Tainted Keeper': 'Coin hearts, which behave differently from the containers this model counts.',
  'Tainted Jacob': 'Hunted by Dark Esau the whole run, which this does not model at all.',
  'Tainted Bethany': 'Runs on blood charges spent out of her own health rather than on soul hearts.',
};

const TAINTED_NOTES = {
  'Tainted Isaac': "Isaac's stats exactly. What changes is that he can carry only eight items at a time.",
  'Tainted Magdalene': 'Three quarters damage, four containers with half of them empty, and health draining the whole way.',
  'Tainted Cain': "Cain's speed and damage, with a crafting bag where the reroll used to be.",
  'Tainted Judas': 'Ordinary until Dark Arts, which is where his entire game lives.',
  'Tainted ???': 'Slower tears and slower feet, throwing poop bombs.',
  'Tainted Eve': 'More damage than Eve at two thirds the fire rate.',
  'Tainted Samson': "Samson's tears and range without his shot speed.",
  'Tainted Azazel': 'Half again the damage at a third of the rate.',
  'Tainted Lazarus': 'Alive he is ordinary. The other half of him is not.',
  'Dead Tainted Lazarus': 'Half again the damage and two soul hearts. The better half of the pair.',
  'Tainted Eden': 'Rolled at random every run, health included.',
  'Tainted Lost': 'Thirty percent more damage and one hit of health, with flight and spectral tears free.',
  'Tainted Lilith': 'The slowest legs in the roster, and a baby doing all the shooting.',
  'Tainted Keeper': 'Coin hearts and tears at -2.2, which is barely a fire rate at all.',
  'Tainted Apollyon': 'Slower tears than Apollyon, and locusts instead of a Void.',
  'Tainted Forgotten': 'Half again the damage, halved rate, and a club. The Soul carries the legs.',
  'Tainted Soul': 'The half that moves. No tears of her own at all.',
  'Tainted Bethany': 'Three containers and six soul hearts, spent as blood charges.',
  'Tainted Jacob': "Jacob's quick tears, with Dark Esau hunting him the whole way.",
};

const res = await fetch(PLAYERS_XML);
if (!res.ok) {
  console.error(`scrape-characters: ${PLAYERS_XML} returned ${res.status}`);
  process.exit(1);
}
const xml = await res.text();

/** hp/armor/black are half-hearts; a container is two of them. */
const players = new Map();
// Match the opening tag however it closes. Eden's element is not self-closing
// — it wraps a <hair> child — so a pattern that insists on "/>" drops her
// entirely and leaves the only character with randomised health at zero.
for (const tag of xml.match(/<player\b[^>]*>/g) ?? []) {
  const attr = (k) => tag.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
  const id = Number(attr('id'));
  if (!Number.isFinite(id)) continue;
  const num = (k) => (attr(k) === undefined ? undefined : Number(attr(k)));
  const hp = num('hp');
  const armor = num('armor') ?? 0;
  const black = num('black') ?? 0;
  players.set(id, {
    hp,
    armor,
    black,
    // A missing hp attribute usually means no red containers at all — Judas in
    // his dark form, the Forgotten, the Soul. It means something else entirely
    // when there is no health of any kind listed, which is Eden: her health is
    // rolled at the start of a run, and reading that as zero would leave her
    // dead before the first fight.
    randomHealth: hp === undefined && armor === 0 && black === 0,
    canShoot: attr('canShoot') !== 'false',
  });
}

// A column with no player id silently loses its health, which is exactly how
// Eden shipped with none at all. Fail loudly instead.
for (const [label, map] of [['COLUMNS', [COLUMNS, PLAYER_ID]], ['TAINTED_COLUMNS', [TAINTED_COLUMNS, TAINTED_PLAYER_ID]]]) {
  const [names, ids] = map;
  const missing = names.filter((n) => ids[n] === undefined);
  if (missing.length) {
    console.error(`scrape-characters: ${label} has no player id for ${missing.join(', ')}`);
    process.exit(1);
  }
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
  put('health', player.randomHealth ? 3 : (player.hp ?? 0) / 2, 3);
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


const tainted = TAINTED_COLUMNS.map((name, i) => {
  const player = players.get(TAINTED_PLAYER_ID[name]) ?? {};
  const stats = {};
  const put = (key, value, base) => {
    if (value === null || value === undefined) return; // not this half of the pair
    if (value !== base) stats[key] = value;
  };

  put('damage', TAINTED_TABLE.damage[i], 3.5);
  put('damageMult', TAINTED_TABLE.damageMult[i], 1);
  put('tears', TAINTED_TABLE.tears[i], 0);
  put('tearsMult', TAINTED_TABLE.tearsMult[i], 1);
  put('speed', TAINTED_TABLE.speed[i], 1);
  put('shotSpeed', TAINTED_TABLE.shotSpeed[i], 1);
  put('range', TAINTED_TABLE.range[i], 6.5);
  put('luck', TAINTED_LUCK[name] ?? 0, 0);
  put('health', player.randomHealth ? 3 : (player.hp ?? 0) / 2, 3);
  put('soulHearts', (player.armor ?? 0) + (player.black ?? 0), 0);

  return {
    id: TAINTED_IDS[name] ?? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name,
    tainted: true,
    stats,
    note: TAINTED_NOTES[name] ?? '',
    ...(TAINTED_CAVEATS[name] ? { caveat: TAINTED_CAVEATS[name] } : {}),
    ...(player.canShoot === false ? { firesTears: false } : {}),
  };
});

characters.push(...tainted);

writeFileSync(
  join(root, 'data/characters.json'),
  `${JSON.stringify({
    note: "Starting stats for Advanced mode. Health and whether a character fires tears come from the game's own players.xml; the combat multipliers are compiled into the game rather than shipped as data, so they are transcribed from the wiki's attribute table — see tools/scrape-characters.mjs, which spells out how that table's columns line up. A character whose attack is not tears carries a caveat rather than a confident DPS number that would be wrong.",
    source: 'players.xml via Derugon/TBoIR-resources (health, canShoot) + wiki attribute table (combat multipliers)',
    characters,
  }, null, 2)}\n`,
);

console.log(`scrape-characters: ${characters.length} characters, ${tainted.length} of them tainted`);
console.log(`  ${characters.filter((c) => c.caveat).length} carry a caveat about how they actually fight`);
