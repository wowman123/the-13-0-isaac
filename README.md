# The 13-0

A draft odds calculator for *The Binding of Isaac*. Pick five items, get the
probability of clearing all thirteen fights without a loss.

Everything the site shows is computed by the same modules the tests and the
calibration solver use — the browser does not have its own copy of the maths.

```
npm start        # http://localhost:8080
npm run check    # build + tests + validation suite
```

## The two layers

Every item record has two layers, and the split is the whole point.

**`scraped`** comes out of `items.xml` and `itempools.xml` — quality, pools,
item type, heart containers. It is never typed from memory. A plausible-looking
wrong quality number is worse than no quality number at all, so when the scrape
layer is absent every record carries `scraped: null` and the UI says
"not scraped" rather than showing something invented.

**`rated`** is hand-assigned combat effectiveness across five axes. This is the
part that cannot be scraped and is where the game's feel lives. It lives in
`data/ratings.psv`, one line per item, designed to be argued with in a diff.

### This repository ships the hand layer only

`data/items.json` currently has `scraped: null` on all 187 records. The game
files are not redistributable and were not available when the ratings were
written, so nothing was guessed to fill the gap. To populate it:

```
node tools/scrape.mjs "/path/to/The Binding of Isaac Rebirth/resources"
node tools/build-items.mjs
```

Two consequences worth knowing before you run it:

- **Ids are matched by name.** `items.xml` has no `COLLECTIBLE_*` constant, only
  a display name, so ids are derived from it (`The Sad Onion` →
  `COLLECTIBLE_SAD_ONION`). Anything that fails to match is printed, never
  silently dropped. Map the leftovers in `data/id-overrides.json`, keyed by the
  XML display name: `{ "1up!": "COLLECTIBLE_ONE_UP" }`.
- **Numeric stat deltas are not in the XML.** The `cache` attribute names *which*
  stats an item moves, never by how much — the deltas live in the game's
  compiled data. Those fields stay `null` and the cache list is recorded in
  `stats.affects` instead.

Items found in the XML that have no hand rating still ship. They fall through to
the tag table, and then to the quality curve, so nothing is ever unrated.

## The five axes

| Axis | Range | Meaning |
|---|---|---|
| `offense` | 0.5 – 3.0 | Effective DPS against one large target. 1.0 is neutral. |
| `aoe` | 0.5 – 3.0 | Damage against adds. Drives the Beast fight. |
| `tracking` | 0.0 – 1.0 | Hit reliability against an erratic, teleporting target. Drives Delirium. |
| `defense` | 0.8 – 2.5 | Effective HP: containers, damage reduction, shields, on-hit heals. |
| `evasion` | 0.0 – 1.0 | Mobility: flight, speed, range. |

A neutral item is `1.0 / 1.0 / 0.0 / 1.0 / 0.0`. **Sad Onion is the calibration
anchor** at `1.22` offense — if an item feels stronger than Sad Onion in a real
run, its offense should exceed 1.22, proportionally to how much stronger.

## Composing a build

- **offense**, **aoe** — multiply all five, then soft-cap at
  `min(p, 3.5 + 0.4 × (p − 3.5))`, so two Q4 damage items cannot produce an
  auto-win.
- **defense** — multiply, hard cap at 4.0.
- **tracking** — `max()`. Homing does not stack; you have it or you do not.
- **evasion** — diminishing: `1 − Π(1 − eᵢ)`.

## Odds

Each of the thirteen fights carries a weight vector over the five axes. Item
ratings never encode boss-specific knowledge — `data/bosses.json` does all of
that, and it is plain editable data.

The multiplicative axes go through `log()` so neutral sits at zero and a halving
mirrors a doubling. A fight's score is the weighted sum; the chance of clearing
it is `sigmoid(slope × (score − threshold))`; the run is the product of all
thirteen.

`slope` and `difficulty` are **solved, not chosen**. `tools/calibrate.mjs`
bisects both against the schema's targets — median draft at 2–8%, top 1% above
40% — and writes `data/config.json`. `tools/validate.mjs` then re-checks on a
different seed, so the fit has to generalise rather than memorise its own sample.

```
$ npm run validate
[  ok  ] every item has at least one tag                187 items
[ .... ] every item has quality + at least one pool     no scrape layer
[ info ] rating coverage                                187 hand-rated, 0 auto
[  ok  ] no item exceeds offense 3.0                    max 2.40
[  ok  ] median 13-0 chance in 2-8%                     5.05%
[  ok  ] top 1% of drafts above 40%                     44.73%
```

Checks that need the scrape layer report `PENDING` rather than `FAIL` — a
missing scrape is a known state of the repo, not a broken dataset.

## The ladder is an assumption

The schema names Delirium and The Beast explicitly and refers to a generic
"bosses 1–12" ramp, which totals fourteen fights rather than thirteen. This
build reads it as **eleven floor bosses, then Delirium, then The Beast**. If
that is the wrong reading, it is thirteen lines in `data/bosses.json` and a
re-run of `npm run calibrate`.

## Layout

```
index.html            three views: draft, items, method
assets/               style.css, app.js
src/engine.js         composition + odds. pure, no DOM, no I/O
src/ratings.js        hand rating -> tag table -> quality fallback
src/scrape-parse.js   items.xml / itempools.xml parsing, pure
data/ratings.psv      the hand layer. edit this one
data/bosses.json      boss weights. all boss knowledge lives here
data/config.json      solved slope + difficulty. generated
data/items.json       generated. do not edit
tools/                scrape, build, calibrate, validate, serve
test/                 39 tests over the engine, the data and the parser
```

Ratings are one person's opinion, argued in public. Everything else is
arithmetic.
