/**
 * Pure parsing of items.xml / itempools.xml. No filesystem, no argv — so it
 * can be tested against a fixture instead of a game install.
 *
 * These two files are one level deep with no mixed content, so a targeted
 * attribute reader is enough. This is not a general XML parser and should not
 * be pointed at arbitrary XML.
 */

const num = (v) => (v == null || v === '' ? null : Number(v));

export function slug(name) {
  return name
    .toUpperCase()
    .replace(/['’`]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

export function parseItems(itemsXml, poolsById) {
  return elements(itemsXml, ['passive', 'active', 'familiar'])
    .filter((e) => e.attrs.id && e.attrs.name)
    .map((e) => {
      const xmlId = Number(e.attrs.id);
      const halves = (attr) => (num(e.attrs[attr]) != null ? num(e.attrs[attr]) / 2 : 0);
      return {
        id: `COLLECTIBLE_${slug(e.attrs.name)}`,
        xmlId,
        name: e.attrs.name,
        quality: num(e.attrs.quality),
        pools: poolsById.get(xmlId) ?? [],
        type: TYPES[e.tag] ?? e.tag,
        tags: (e.attrs.tags ?? '').split(/\s+/).filter(Boolean),
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
    if (overrides[s.name]) s.id = overrides[s.name];
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

export function parseResources(itemsXml, poolsXml, handIds = [], overrides = {}) {
  const poolsById = parsePools(poolsXml);
  const items = parseItems(itemsXml, poolsById);
  return { poolCount: poolsById.size, ...reconcile(items, handIds, overrides) };
}
