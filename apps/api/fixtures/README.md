# Backtest fixtures

## `backtest-ground-truth.json`

Verified historical cases for measuring whether Signal's forecaster would have
called a real devtool launch before it happened.

Every date and URL in that file was read from the vendor's own blog. Nothing is
inferred or estimated, and a case that could not be verified from a primary
source was left out rather than approximated.

### Why this is not yet a benchmark

Two things stand between this file and a published accuracy number, and both
are stated here rather than papered over — a forecasting product that overstates
its own track record has destroyed the only thing it was selling.

**1. Two cases is not a sample.** Any Brier score computed from two positive
cases and no controls is noise. The file needs roughly an order of magnitude
more cases, including controls, before a number from it means anything.

**2. Controls are missing and must not be invented.** A control case is a window
of routine competitor activity where no launch followed. Asserting "nothing
happened here" requires the same primary-source rigour as asserting something
did. Fabricated controls would silently inflate specificity, which is exactly
the failure this product exists to argue against.

**3. The harness scores captured predictions, not live ones.** `scripts/backtest.ts`
reads a dataset in which each case already carries a `prediction` block — it
grades predictions made elsewhere. Producing those predictions requires running
the forecaster against signals collected inside each case's observation window,
and that requires a database with real collected history for these subjects.
A fresh workspace has none.

### What has to happen to produce a real number

1. Track these subjects in a real workspace and let the collectors accumulate
   history — GitHub, changelog, HN and jobs for each.
2. Extend `scripts/backtest.ts` to invoke `forecasterNode` against evidence
   filtered to `observed_at <= observation_cutoff`, rather than reading a
   pre-captured `prediction` block. Until that exists, the harness cannot grade
   this file.
3. Grow the case file, controls included.
4. Run it, and publish whatever comes out. A weak score is a finding that
   changes the product; it is not something to fix by editing this file.

### Adding a case

A case is admissible only if all of the following hold:

- The announcement date comes from the vendor's own post, not a secondary write-up.
- The pre-announcement artifact is genuinely public and genuinely earlier, with
  its date read the same way.
- The artifact plausibly signals the specific thing that shipped. A generic
  "we are working on performance" post does not qualify as a signal for a named
  feature launch.
