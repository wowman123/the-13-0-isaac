# Contributing

The ratings are the product. They are also the least certain thing here, so
disagreeing with them in a pull request is the most useful contribution
available.

## Arguing with a rating

Every hand-assigned rating lives on one line of `data/ratings.psv`:

```
id|name|offense|aoe|tracking|defense|evasion|tags|note
```

One line per item, so a rating change is a one-line diff that can be discussed
on its own terms. Change the number, then:

```
npm run check      # rebuild, test, and re-validate
```

Two things to keep in mind while you argue:

- **Sad Onion is the anchor.** It sits at `1.22` offense. If an item feels
  stronger than Sad Onion in a real run, its offense should exceed 1.22, and
  the gap should be proportional to how much stronger. Calibrate against that,
  not against a mental 0-10 scale.
- **Ratings never encode boss-specific knowledge.** "Good against Delirium" is
  not a rating, it is high `tracking`. The boss weight vectors in
  `data/bosses.json` do all of the boss-specific work, and keeping that
  separation is what stops the model becoming a pile of special cases.

If a change moves the distribution far enough that calibration drifts, re-solve
it — do not hand-edit `data/config.json`:

```
npm run calibrate
```

## Adding an item

Add a line to `data/ratings.psv` and rebuild. `every item has sprite art` will
fail if the name does not match a collectible in the sprite pack, which is
usually the check telling you one of two things: the name is spelled
differently in game, or the thing you added is a trinket or a card rather than
a collectible. Both have happened.

## What the tests actually guard

- The composition rules match the written spec, exactly.
- Every rating sits inside its declared range.
- No item exceeds `offense` 3.0.
- Calibration still lands on target — median draft at 2-8%, top 1% above 40% —
  measured on a *different* random seed than the solver fitted on, so a fit has
  to generalise rather than memorise its own sample.

`npm run check` runs all of it. CI runs the same command, so if it passes
locally it will pass there.

## Things that are still open

- `scraped` is `null` for every record until someone runs `tools/scrape.mjs`
  against a game install. Quality and pools are missing until then.
- The thirteen-fight ladder is an interpretation. The schema names Delirium and
  The Beast plus a "bosses 1-12" ramp, which totals fourteen; this build reads
  it as eleven floor bosses, then Delirium, then The Beast. If that is wrong it
  is thirteen lines in `data/bosses.json` and a re-run of `npm run calibrate`.
- No rating here has been checked against how the game actually plays. They
  were assigned by one author in one sitting and calibrated to hit a target
  distribution, which is not the same as being right.
