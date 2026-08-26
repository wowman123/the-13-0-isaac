/**
 * Pure parsing of items.xml / itempools.xml. No filesystem, no argv — so it
 * can be tested against a fixture instead of a game install.
 *
 * These two files are one level deep with no mixed content, so a targeted
 * attribute reader is enough. This is not a general XML parser and should not
 * be pointed at arbitrary XML.
 */

const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Turn an items.xml `name` into an id stem.
 *
 * Repentance stores a localisation key (`#THE_SAD_ONION_NAME`) rather than a
 * display name. That is the better key of the two — it is effectively the
 * collectible constant — so it is unwrapped and used directly. Older dumps and
 * the test fixture carry real display names, which still fall through to the
 * slugify path.
 */
export function slug(name) {
  const localisationKey = /^#(.+?)_NAME$/.exec(name.trim());
  if (localisationKey) return localisationKey[1].toUpperCase();

  return name
    .toUpperCase()
    .replace(/['’`]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A readable label from a localisation key: #ODD_MUSHROOM_THIN_NAME becomes
 * "Odd Mushroom Thin". Hand-rated items override this with their curated name;
 * this is what the imported tail displays.
 */
/**
 * Words that stay lowercase inside a title. Without this every name reads
 * "Book Of The Dead", which is not how the game writes it.
 */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'to', 'for', 'from', 'with']);

export function humanise(name) {
  const key = /^#(.+?)_NAME$/.exec(name.trim());
  if (!key) return name;
  const words = key[1].toLowerCase().split('_').filter(Boolean);
  return words
    .map((w, i) => {
      if (/^\d/.test(w)) return w;
      // A small word is only lowercase in the middle; it still opens a title.
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Strip the prefix and article so hand ids and XML names can be compared. */
export const normaliseId = (id) => id.replace(/^COLLECTIBLE_/, '').replace(/^THE_/, '');

function elements(xml, tagNames) {
  const re = new RegExp(`<(${tagNames.join('|')})\\b([^>]*?)/?>`, 'gi');
  const out = [];
  for (const m of xml.matchAll(re)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}

/** numeric item id -> ["treasure", "boss", ...] */
export function parsePools(poolsXml) {
  const byId = new Map();
  for (const block of poolsXml.matchAll(/<Pool\b([^>]*)>([\s\S]*?)<\/Pool>/gi)) {
    const name = /Name\s*=\s*"([^"]*)"/i.exec(block[1])?.[1];
    if (!name) continue;
    for (const entry of block[2].matchAll(/<Item\b[^>]*\bId\s*=\s*"(\d+)"/gi)) {
      const id = Number(entry[1]);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(name.toLowerCase());
    }
  }
  return byId;
}

const TYPES = { passive: 'passive', active: 'active', familiar: 'familiar' };

/**
 * items.xml `cache` says which stats an item moves. That is the only mechanical
 * signal available for items nobody has hand-rated, and without it the imported
 * tail carries only categorical tags (offensive, summonable, mom) which share
 * no vocabulary with the synergy rules — so no rule could ever fire on them.
 */
const CACHE_TAGS = {
  damage: 'damage_up',
  firedelay: 'tears_up',
  speed: 'speed_up',
  range: 'range_up',
  luck: 'luck_up',
  shotspeed: 'shot_speed',
  flying: 'flight',
};

/** A handful of XML tags that describe a mechanic rather than a family. */
const XML_TAG_ALIASES = {
  tearsup: 'tears_up',
  fly: 'familiar',
  syringe: 'damage_up',
};

function mechanicalTags(cache, xmlTags, type, hearts) {
  const out = new Set();
  for (const c of cache) if (CACHE_TAGS[c]) out.add(CACHE_TAGS[c]);
  for (const t of xmlTags) if (XML_TAG_ALIASES[t]) out.add(XML_TAG_ALIASES[t]);
  if (type === 'familiar') out.add('familiar');
  if (type === 'active') out.add('active');
  if (hearts.red > 0) out.add('health_up');
  if (hearts.soul > 0 || hearts.black > 0) out.add('soul_hearts');
  return [...out];
}

/**
 * numeric item id -> { quality, tags }
 *
 * Quality is not in items.xml. It lives in items_metadata.xml, keyed by the
 * same numeric id, as <item id="1" quality="3" tags="..."/>.
 */
export function parseMetadata(metadataXml) {
  const byId = new Map();
  if (!metadataXml) return byId;

  for (const m of metadataXml.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    if (attrs.id == null) continue;
    byId.set(Number(attrs.id), {
      quality: attrs.quality == null ? null : Number(attrs.quality),
      tags: (attrs.tags ?? '').split(/\s+/).filter(Boolean),
    });
  }
  return byId;
}

export function parseItems(itemsXml, poolsById, metaById = new Map()) {
  return elements(itemsXml, ['passive', 'active', 'familiar'])
    .filter((e) => e.attrs.id && e.attrs.name)
    .map((e) => {
      const xmlId = Number(e.attrs.id);
      const halves = (attr) => (num(e.attrs[attr]) != null ? num(e.attrs[attr]) / 2 : 0);
      const meta = metaById.get(xmlId);
      return {
        id: `COLLECTIBLE_${slug(e.attrs.name)}`,
        xmlId,
        // Keep the raw key: id-overrides.json is keyed by it, and humanising
        // before reconcile silently breaks every override.
        xmlName: e.attrs.name,
        name: humanise(e.attrs.name),
        // items.xml may carry quality inline; newer dumps only have it in the
        // metadata file. Prefer whichever is actually present.
        quality: num(e.attrs.quality) ?? meta?.quality ?? null,
        pools: poolsById.get(xmlId) ?? [],
        type: TYPES[e.tag] ?? e.tag,
        tags: (() => {
          const xmlTags = [...new Set([
            ...(e.attrs.tags ?? '').split(/\s+/).filter(Boolean),
            ...(meta?.tags ?? []),
          ])];
          const cache = (e.attrs.cache ?? '').split(/\s+/).filter(Boolean);
          const type = TYPES[e.tag] ?? e.tag;
          const hearts = { red: halves('maxhearts'), soul: halves('soulhearts'), black: halves('blackhearts') };
          return [...new Set([...xmlTags, ...mechanicalTags(cache, xmlTags, type, hearts)])];
        })(),
        stats: {
          // Actually present in the XML, in half-hearts.
          red_containers: halves('maxhearts'),
          soul_hearts: halves('soulhearts'),
          black_hearts: halves('blackhearts'),
          // NOT in the XML. `cache` names which stats an item moves, never by
          // how much — the deltas live in the game's compiled data. Leaving
          // these null is the honest answer; filling them in would be invention.
          damage_flat: null,
          damage_mult: null,
          tears_flat: null,
          firerate_mult: null,
          shot_speed: null,
          range: null,
          speed: null,
          luck: null,
          affects: (e.attrs.cache ?? '').split(/\s+/).filter(Boolean),
        },
      };
    });
}

/**
 * Line the scraped records up with the hand-rated ids.
 *
 * items.xml has no COLLECTIBLE_* constant, only a display name, so ids are
 * derived from the name and matched loosely. Anything that fails to match is
 * returned for the caller to report — never silently dropped.
 */
export function reconcile(scraped, handIds, overrides = {}) {
  for (const s of scraped) {
    const override = overrides[s.xmlName] ?? overrides[s.name];
    if (override) s.id = override;
  }

  const byNorm = new Map(scraped.map((s) => [normaliseId(s.id), s]));
  const matched = [];
  const unmatched = [];

  for (const handId of handIds) {
    const hit = byNorm.get(normaliseId(handId));
    if (hit) {
      hit.id = handId; // adopt the hand layer's id so the merge lines up
      matched.push(handId);
    } else {
      unmatched.push(handId);
    }
  }

  return { scraped, matched, unmatched };
}

export function parseResources(itemsXml, poolsXml, handIds = [], overrides = {}, metadataXml = '') {
  const poolsById = parsePools(poolsXml);
  const metaById = parseMetadata(metadataXml);
  const items = parseItems(itemsXml, poolsById, metaById);
  return {
    poolCount: poolsById.size,
    metaCount: metaById.size,
    ...reconcile(items, handIds, overrides),
  };
}
