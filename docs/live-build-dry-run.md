# The live build dry run (12 November 2026)

Ten real end-to-end builds on live models, to find out how the live build behaves outside the two runs we had
tried by hand. Everything below comes from the records in `evals/live-build/records/`. The runner is
`scripts/live-build-dry-run.mjs` (`npm run live-dry-run`).

## The short version

- All 10 builds finished. None failed, none stopped at its limit, and five at once caused no rate-limit errors.
- **Cost $0.25 to $0.45 a build, $3.48 in all** (mean $0.35). Each build had a hard limit of $0.75 and none came near it.
- **Time 8 to 33 minutes** with five running at once. A single build on its own took 16 to 17 minutes earlier.
- **Every build passed its acceptance tests on the first run.** No build needed a fix round, so the fix path has
  still not run live. Model A's own unit tests did not all pass: 3 failed in two builds (01 and 07), and the pipeline
  did not count unit tests. Both causes are now fixed (see "How strong the tests are").
- **Mutation testing: the tests caught 67% of 208 small breaks** in the final code (50% to 100% per build). Most
  survivors are in input checks, but some are real gaps, such as a pallet exactly at the weight limit.
- **Reviewers raised a P0 in 5 of the 10 builds**, before any code was run. Three builds had no finding at all.
  Read by hand, **3 of the 9 P0s were serious, 5 were real but rated too high, and 1 was a false alarm** that the
  builder correctly declined (see "What the reviews caught").
- **The diagram step worked.** 7 drawings passed the check first time. 3 needed the one correction and passed after
  it. None was dropped.
- **The brief with a wrong example** ("100 cartons needs 2 pallets" when it needs 3) was not followed. The pipeline
  said the example was wrong and built to the rules.

## How it was run

Ten briefs across the five domains, written for this run, all made up, none with personal data
(`evals/live-build/briefs.json`). Seven were clear. **Three were built to cause trouble:** two left a rule vague, and
one gave an example that contradicts its own rules.

The live service runs one build at a time, so the script started five staging servers and gave each two briefs in
turn. Each server had the full build switched on, its own passcode, a daily cap of $2, and a limit of $0.75 a build.
The script was also set to stop starting builds if the total reached $6.50. It did not. Model A was Claude Opus 5.5
and Model B was Grok 4.7. The code ran in the isolated sandbox (`packages/studio/src/isolate.ts`).

## Results

| Build | Domain | Cost | Time | Acceptance tests | Reviews raised (panel / design / code) | Diagram |
| --- | --- | --- | --- | --- | --- | --- |
| 01 claim window | healthcare | $0.35 | 14 min | 7 | none / none / none | corrected once |
| 02 duplicate claims (vague) | healthcare | $0.33 | 15 min | 8 | 2 P1 1 P2 / none / none | first try |
| 03 grade weights | education | $0.40 | 22 min | 8 | 3 P2 / 1 P0 / none | first try (contract revised) |
| 04 attendance streak | education | $0.31 | 11 min | 8 | 1 P1 1 P2 / 1 P0 / none | corrected once |
| 05 stacked promo (vague) | fmcg | $0.43 | 22 min | 8 | 1 P0 2 P1 1 P2 / 1 P2 / 1 P0 | first try |
| 06 reorder point | fmcg | $0.25 | 8 min | 6 | none / none / none | first try |
| 07 interest days | finance | $0.40 | 14 min | 6 | none / 1 P0 1 P1 / none | corrected once |
| 08 velocity alert | finance | $0.31 | 17 min | 8 | 1 P1 1 P2 / none / none | first try |
| 09 window overlap | logistics | $0.25 | 10 min | 6 | none / none / none | first try |
| 10 pallets, wrong example | logistics | $0.44 | 33 min | 8 | 3 P0 1 P1 2 P2 / 1 P0 2 P1 / none | first try |

"Panel" is the requirements panel, including the final check. Times are wall-clock with five builds running at the same
time. The same numbers are in `evals/live-build/results-2026-11-12.json`.

## What the reviews caught, and what they got wrong

The ten builds raised 29 findings in all: 20 on the requirements, 8 on designs and 1 on code. Nine were rated P0. I read
all nine against the text they point at. **This is one reader's check, not the independent rating planned in
`evals/live-build/judging/`.** It is a starting point.

**Serious and real (3).** Found by the other model before any test ran, and fixed.
- **Build 03, design:** the design read `exam[0]` whenever the exam list existed. An empty list exists, so `exam[0]` is
  undefined and the grade would be wrong for a student with no exam. The builder fixed it and added a test.
- **Build 10, requirements:** Model A's review of draft B showed that dividing total weight by 1000 ignores that cartons
  cannot be split: 5 cartons of 400 kg is 3 pallets, not 2.
- **Build 10, final check:** three rules in the merged PRD disagreed about a carton count of zero. The builder confirmed
  and fixed it.

**Real, but rated too high (5).**
- **Build 04, design:** "Otherwise set count to 0" can be read as belonging to the "count is 3" check, which would stop a
  streak ever reaching 3. The sentence is ambiguous, but the design's own rules check says a present day resets the
  count, so the intended meaning is clear. A wording problem, not a P0.
- **Build 05, final check:** an example went from 0.05 straight to 0.045 and skipped the discount step. The result was
  right and the wording was sloppy.
- **Build 07, design:** adding an epsilon before rounding can move a value that sits just below a half-cent onto it. That
  is a real risk but a rare one, closer to P1.
- **Build 10, requirements:** "100 / 48 = 2.08" was called wrong because the quotient is 2.0833. It is a rounded figure.
- **Build 10, design:** a floating-point case where the next double above 1000/9 gives 9 cartons weighing 1000 plus a
  tiny amount. Real in principle and contrived in practice.

**A false alarm (1).** In build 05, the code review said "a `BigInt` added to a string throws a `TypeError`, so every
valid line crashes." That is wrong. In JavaScript `1n + "a"` gives `"1a"`. Only a `BigInt` mixed with a `Number` throws.
Model A **declined** the finding and said exactly this, with a worked trace. I checked it in Node. I first took this
for a real defect when writing the page, which is why the independent rating matters.

So reviewers over-rate: the same pattern as in the earlier evaluation (9 of 16 final-review P0s were over-rated or
wrong). A builder that is allowed to decline a finding with a reason, as Model A is, is what stopped the false alarm.

## The diagram step

Model A drew the design as a diagram in every build, and the check ran on every drawing. Seven drawings passed first
time. Three failed the check and passed after the one correction. All three were length limits (sub text over 31
characters, an edge label over 30), not wrong files or invented findings. Nothing was dropped. A looser limit, or
cutting long text, would save the extra call, which costs about $0.04.

## The three briefs built to cause trouble

- **"Duplicates when they look the same" (02).** The pipeline chose an exact match on four fields (patient reference,
  service date, procedure code and amount), left the claim id out so a resubmission is still caught, and kept
  near-matches out of scope. It wrote the choice down for the requester to confirm.
- **A 10% discount with buy-3-get-1-free (05).** The brief did not say which applies first. The design assumed the
  discount applies to the paid units only and rounds half-up once at the end, and flagged both as assumptions to
  confirm. This build cost the most after build 10.
- **A wrong example (10).** The brief said 100 cartons of 8 kg need 2 pallets. The final PRD says "the made-up example
  answer of 2 is wrong, because 2 pallets hold at most 96 cartons", and the acceptance tests expect 3. This was the
  slowest and most expensive build, with 9 findings across the panel and the design.

## How strong the tests are

`npm run live-build-mutation` (run on 12 November 2026, no model calls) breaks each build's final code in small,
systematic ways, with the operators the page uses: `<=` to `<`, `&&` to `||`, a number plus one, and so on. It then
re-runs the tests. A mutant that no test notices "survives". It runs Model A's unit tests and Model B's acceptance tests
separately and together, in a child process with no environment, no file access and its own network namespace.

| Build | Mutants | Unit tests (A) | Acceptance tests (B) | Both |
| --- | --- | --- | --- | --- |
| 01 claim window | 38 | 50% | 50% | 50% |
| 02 duplicate claims | 2 | 100% | 100% | 100% |
| 03 grade weights | 21 | 90% | 90% | 90% |
| 04 attendance streak | 12 | 92% | 92% | 92% |
| 05 stacked promo | 33 | 67% | 64% | 67% |
| 06 reorder point | 2 | 100% | 100% | 100% |
| 07 interest days | 37 | 49% | 49% | 49% |
| 08 velocity alert | 10 | 90% | 90% | 90% |
| 09 window overlap | 9 | 89% | 89% | 89% |
| 10 pallets | 44 | 66% | 50% | 66% |
| **All** | **208** | **67%** | **63%** | **67%** |

- **Model B's acceptance tests, written without seeing the code, added nothing.** Every mutant they caught, Model A's
  unit tests caught too. Model A's tests caught more in three builds (01, 07, 10).
- **Most of the 69 survivors (50) are in input checks and date parsing**, for example `||` turned into `&&` in "is this
  a number". The tests try few bad inputs, one at a time.
- **19 survivors are in the calculation.** Some make no difference (equivalent mutants), such as changing a constant
  that is only used to split a float. Others are real gaps: in 10 a pallet exactly at the weight limit is never tested
  (`p < MAX_KG` to `p <= MAX_KG` survives); in 08 the loop can skip the first timestamp; in 09 an overlap of exactly one
  minute is never tested; in 07 the exact-half rounding rule can change unnoticed.
- **Two scores of 2 mutants (02, 06) say little.** That code has almost no comparisons or numbers to break.

**Three of Model A's unit tests failed, and the build did not notice.** In 01 (2 tests) and 07 (1 test), Model A wrote
`assert.throws(fn, /^Error: unknown field: extra$/)`, as Node's `assert.throws` would read it: there the pattern is
tested against `"Error: <message>"`. The test runner in `public/tests.js` tests it against the message alone, so the
tests fail although the code is right. The build records show these failures, but `build.ts` counts only acceptance
tests when it decides whether a run passed or needs a fix round, so the builds were reported as fully passing.

Both are now fixed. `assert.throws` accepts a pattern for either form, so all three tests pass on the recorded code.
A failing unit test now starts a fix round like a failing acceptance test, and the record counts both
(`runs[].unitFailing`). Model A wrote the unit tests, so in a fix round it may rewrite them if it judges one wrong;
the record marks that (`fixes[].unitScriptChanged`), and the acceptance tests are never rewritten. The table above was
re-run after the fix and did not change: the three tests now pass but catch no extra mutants. The mutation run still
leaves out any test that fails on the real code, since such a test would "catch" every mutant (with the old assert,
01 and 07 scored 100%).

## What this does not show

- **No build failed.** The red-run and fix-round path has never run on live output. To test it I would need briefs
  built to make a model's first code wrong.
- **Passing tests is weak evidence on its own.** The tests come from the PRD that the same pipeline wrote. They show
  the code matches the pipeline's reading of the brief, not the requester's intent. Reviewers raised a P0 in half the
  builds before any code ran, so first-run passes mostly reflect problems fixed upstream. Nobody reviewed the code
  quality.
- **The briefs are small.** Each is one pure function in a made-up domain, which is the kind of feature the sandbox
  and the contract step suit. A real change to an existing codebase is harder, and this run says nothing about it.
- **The findings have not been independently judged.** My read of the nine P0s is one reader, and I made a mistake
  on one of them. The 20 non-P0 findings have not been read for accuracy at all. The rating sheets for two people are
  in `evals/live-build/judging/`.
- **It tests the pipeline, not the hosted site.** The builds ran on a local machine. A later check showed Railway cannot
  reliably isolate the network: `unshare -rn` was denied as the `node` user on every run, so the hosted site refuses
  to run model-written code (see `docs/how-it-is-built.md`).
- **A mutation score is not a bug count.** It shows where the tests are thin, not whether the code is wrong. The
  operators are simple ones, and nobody has yet sorted the survivors into equivalent mutants and real gaps one by one.

## Files

| What | Where |
| --- | --- |
| The ten briefs | `evals/live-build/briefs.json` |
| One full record per build: the panel, every build stage, every call's cost | `evals/live-build/records/` |
| The results in one file | `evals/live-build/results-2026-11-12.json` |
| The runner | `scripts/live-build-dry-run.mjs` |
| Mutation testing on the ten builds: every mutant, which test caught it, the survivors | `evals/live-build/mutation-2026-11-12.json` (`npm run live-build-mutation`, free) |
| The rating kit: 29 findings, a blind sheet for each of two raters, a page per build, and the key | `evals/live-build/judging/` (`npm run judging-prepare`, then `npm run judging-analyze`) |

The runner in the repository is a tidied copy of the script that produced these results. It has not been run since, and
running it spends about $3.50.
