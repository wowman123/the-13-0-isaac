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

`data/items.json` currently has `scraped: null` on all 181 records. The game
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
[  ok  ] every item has at least one tag                181 items
[ .... ] every item has quality + at least one pool     no scrape layer
[  ok  ] every item has sprite art                      181 sprites
[ info ] rating coverage                                181 hand-rated, 0 auto
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

## Sprites

Each item renders its in-game sprite in the slots, the picker and the table.
`assets/sprites/` holds one 64px PNG per item, keyed by collectible id, built
from an HD sprite pack with:

```
python3 tools/build-sprites.py "/path/to/TBOI HD Sprites"   # needs Pillow
```

Only items present in `data/ratings.psv` are emitted, so the repo carries ~180
sprites rather than a whole pack. Source art is 512x512 with inconsistent
padding, so each sprite is trimmed to its alpha bounding box and fitted into a
common box — otherwise a tall item and a wide one render at very different
apparent sizes in the same row.

The sprite art is from The Binding of Isaac and belongs to its authors. It is
included here for a fan tool, not licensed by this project; the sprite pack
itself is not committed, only the derived per-item PNGs.

### The art check earns its keep

Matching the dataset against the pack immediately found nine items with no
collectible sprite, and every one was a real defect in the hand layer:

- **Wrong name** — `Mom's Pearl`, `Stem Cell` and `Odd Mushroom (Large)` were
  renamed to `Mom's Pearls`, `Stem Cells` and `Odd Mushroom (Thick)`. In the
  first two cases the singular is a *trinket* and the plural is the collectible.
- **Trinkets, not collectibles** — Apple of Sodom, Broken Ankh and Torn Card
  were removed.
- **Not collectibles at all** — Soul of Lazarus is a soul stone; Mark of the
  Beast and Uriel's Vestment do not appear anywhere in a pack covering 717
  collectibles. Removed.

That is the schema's "never type it from memory" principle catching the author
in the act, which is why `every item has sprite art` is now a test: a trinket or
a card has no collectible sprite, so the check doubles as a guard against
non-collectibles creeping back into the pool.

## Design

The look takes its cues from [Isaacle](https://isaacle.net/): a tiled pixel
brick wall behind parchment panels with thick cream frames, blood-red pixel
headings, and a coral-to-green scale for good and bad news. That scale does
real work here — it drives the per-fight ladder bars and the hero meter through
one shared `oddsColour()` ramp, so a red row means the same thing everywhere.

The background is a supplied Isaac room texture rather than a flat colour. Its
interior is nearly uniform, so upscaling the whole image to fill a wide viewport
would only blur it; instead the stone border is a CSS `border-image` pinned to
the viewport at its own resolution, and the floor is a mirror-tiled patch from
the room's interior. The page reads as something happening inside a room, and
the sticky header stops below the frame rather than sliding under it.

The CSS is written from scratch in that visual language, not lifted from the
source site.

Type is [Silkscreen](https://github.com/googlefonts/silkscreen) by Jason Kottke,
under the SIL Open Font License 1.1 — the license text ships alongside the font
in `assets/fonts/`. It is self-hosted (16 KB for both weights) so the design
does not depend on a third-party font CDN at render time. Long prose keeps a
system sans, because a pixel face is a poor way to read three paragraphs about
soft caps.

One typographic gotcha worth knowing before you edit strings: Silkscreen's Latin
subset has no `→` (U+2192), so arrows use `»` and empty states use `?` rather
than `—`, which renders as a solid bar at display sizes.

## Deploying

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to the
repository's **default branch**, whatever it is called — the job compares
`github.ref_name` against `github.event.repository.default_branch` rather than
hardcoding `main`. It runs `npm run check` first, so a failing test or a
drifted calibration blocks the deploy rather than shipping.

Two things have to be true before anything publishes:

1. **The repo must be public**, or on a paid plan. GitHub Pages is not
   available for private repositories on GitHub Free.
2. **Settings → Pages → Source must be set to "GitHub Actions"**, not "Deploy
   from a branch". Until then the workflow runs and produces an artifact that
   nothing serves.

The published bundle is assembled explicitly — `index.html`, `assets`, `src`,
`data`, `404.html`, `robots.txt` — so the tools and the test suite are not
served. `.nojekyll` stops GitHub from running the files through Jekyll.

`.github/workflows/ci.yml` runs on every branch and pull request. Besides the
test suite it asserts two structural things: that the project still has zero
dependencies, and that `data/items.json` is not stale relative to
`data/ratings.psv`.

The site works from a subdirectory (`user.github.io/the-13-0-isaac/`) — every
path in the page is relative, and routing is hash-based, so there is no
base-path configuration to get wrong.

To regenerate the social card after a design change:

```
npm start                    # in one shell
node tools/build-og.mjs      # in another; needs playwright
```

## Licensing, in short

- **`LICENSE`** — MIT, covering the engine, tools, tests, site and the ratings.
- **`NOTICE.md`** — what MIT does *not* cover: the sprite art belongs to the
  game's authors, the font is OFL, and scraped game data is never redistributed
  here. Read this before publishing a fork.

This is an unofficial fan tool with no affiliation to the game's authors or
publisher, stated both in `NOTICE.md` and in the site footer. Removing the
sprite art is one command and breaks nothing:

```
rm -rf assets/sprites && node tools/build-items.mjs
```

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
assets/fonts/         self-hosted Silkscreen (OFL 1.1) + its license
assets/sprites/       one 64px PNG per item, keyed by collectible id
assets/room-frame.png room border, used as a CSS border-image
assets/room-floor.png mirrored floor tile from the room interior
assets/og-image.png   social card, rendered from assets/og-template.html
404.html              styled not-found page for Pages
.github/workflows/    ci.yml (every branch) and pages.yml (deploy from main)
tools/                scrape, build, calibrate, validate, serve
test/                 40 tests over the engine, the data and the parser
```

Ratings are one person's opinion, argued in public. Everything else is
arithmetic.
