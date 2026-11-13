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
- **Mutation testing: the tests caught 67% of 208 small breaks** in the final code (50% to 100% per build). Of the
  69 that survived, 33 can never change a result; leaving those out, the tests caught 79%. 22 are real gaps on valid
  input, 15 of them on ordinary values, such as one carton, a price of 0 or 1, or a date on the 1st or the 31st.
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
  unit tests caught too. Model A's tests caught more in three builds (01, 07, 10). Model B's prompt has since been
  changed (see "A better prompt for Model B's tests").
- **Two scores of 2 mutants (02, 06) say little.** That code has almost no comparisons or numbers to break.

### Sorting the 69 survivors

A survivor is either a gap in the tests (some input gives a different answer and no test tries it) or an equivalent
mutant (nothing can tell it from the real code, so no test could catch it). `npm run live-build-survivors` runs the
real code and each survivor side by side on inputs built from each contract: boundaries, a sweep of ordinary values,
every `2026-MM-DD` from `00` to `99` for the date builds, weights next to an exact 1000 kg pallet, and inputs that
break the contract, labelled invalid. Each gap is reported with the input that shows it. Survivors that no input
told apart were then reasoned through one by one; the reasons are in `evals/live-build/survivors-equivalent.json`.

| Verdict | Count | What it means |
| --- | --- | --- |
| Gap, ordinary input | 15 | A plain valid input gives a different answer, and no test tries it |
| Gap, extreme input | 7 | Only prices like `1e-7` or `1e21`, a date range crossing the year 2000, or a product that rounds to exactly 1000 kg |
| Gap, invalid input only | 13 | Only a bad input tells it apart, usually by giving a different error |
| Equivalent | 33 | Can never change a result (reason recorded for each) |
| No difference found | 1 | Not shown equivalent, but no input of 8,910 told it apart (build 10's float-splitting constant) |

Leaving out the 33 equivalent mutants, the tests caught 139 of 175, or **79%**, against 67% counting every mutant.

**The 15 ordinary gaps** are values the tests never use:

- **01 claim window (4):** no date in December, on the 1st or on the 31st. A version that rejects any of them as
  "invalid date" passes every test.
- **03 grade weights (1):** a version that also drops the first homework score, when it drops the lowest, passes every
  test. The tests either put the lowest score first, or use 90, 80, 70, 100, where dropping the 70 leaves an average
  of 90 and dropping the 90 as well happens to leave 90 too.
- **05 stacked promo (3):** a price of 0 is never tried, nor a price of exactly 1. A version that rejects a free item, prices
  a 1.00 item at 0, or a free item at 1.00, passes.
- **07 interest days (4):** no month from October to December and no day from the 10th on (the date parsing can be
  broken for them), no principal of 1 or less, and the exact-half rounding rule, which the PRD leaves open, can change
  unnoticed.
- **09 window overlap (1):** an overlap of exactly one minute.
- **10 pallets (2):** a single carton (a version that ships it on 0 pallets passes), and a carton of 1 kg or less.

**The 7 extreme gaps** need inputs few people would write: prices in exponent form (`1e-7`, `1e21`) in 05, a date
range crossing 2000 in 07, and in 10 a weight such as 1000/7 kg, where 7 cartons come to 1000.00000000000003 kg in
exact arithmetic but exactly 1000 in floating point. The code's careful product says 6 fit; a plain comparison says 7.

**The 13 invalid-input gaps** mostly change which error is thrown: `null` instead of an object gives a TypeError
instead of the code's own message, a field set to `undefined` is called invalid rather than missing, and in 07 a zero
principal or rate, a `NaN` amount or a date with trailing text (`"2026-04-01x"`) is accepted when the check is broken.

**The 33 equivalent mutants** are mostly belt-and-braces code. In 01 and 07 a date is checked twice, by a range check
and by building the date and confirming it round-trips, so breaking either check changes nothing (confirmed on every
`2026-MM-DD` from `00` to `99`). `setUTCHours(0, 0, 0, 0)` nudged by an hour, minute, second or millisecond is
rounded away. In 10, the loops that adjust the cartons per pallet can never reach the cases the mutants change.

Two examples given in an earlier version of this page were wrong. The velocity check's loop starting at the second
payment (08) is equivalent, not a gap: one payment cannot raise an alert. And the pallet weight-limit mutant (10) is
not about a pallet at exactly 1000 kg, which gives the same answer either way, but about the floating-point case above.

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

### A better prompt for Model B's tests

The ordinary gaps are values a careful tester tries first, so Model B's prompt now asks for them. It used to say only
"write the acceptance test cases from the PRD, at most 8". It now asks for up to 16, covering every requirement and
then the edges where code usually goes wrong: each limit exactly and one step either side; zero, one and the smallest
allowed value; an empty list and a single item; an item a rule picks out being first, in the middle and last; the 1st
and last day of a month, December and January, a leap day; one case per named error. It also asks for values where a
plausible mistake gives a different answer (the 90, 80, 70, 100 coincidence above), and for no test of behaviour the
PRD leaves open. The prompt names no build. It is `ACCEPTANCE_CASES_PROMPT` in `studio/src/build.ts`.

To measure it, `npm run acceptance-eval` re-ran only Model B's two test steps (cases, then script) on the ten
recorded PRDs and contracts, twice with the old prompt and twice with the new, and `npm run acceptance-score` scored
every script against the recorded code. 40 samples cost $0.80 (plus about $0.06 for three failed answers).

| Prompt | Tests a build | Tests wrong on the real code | Mutants caught (of 175 that can change a result) | Ordinary gaps closed (of 15) |
| --- | --- | --- | --- | --- |
| As recorded | 7.3 | 0 | 75% | 0 |
| Old prompt, run again (2 samples) | 7.3 | 0 | 75% | 0 |
| New prompt (2 samples) | 15.3 | 0 | **85%** | **11.5** |

- **Better in 7 builds, worse in none.** 10 pallets went from 63% to 83%, 01 claim window from 76% to 92%, 09 window
  overlap from 89% to 100%.
- **No wrong tests.** None of the 306 new tests fails on the real code.
- **Still open:** 07's exact-half rounding (rightly untested: the PRD leaves it open), a principal of 1 or less (07),
  a carton of 1 kg or less (10), and a price of exactly 1 (05, closed in one sample of two). None of the 7 extreme
  gaps or the 13 invalid-input gaps closed.
- **The cost:** about $0.013 more a build, and about 4.5 minutes longer (Model B's two steps took 450 s, not 181 s).
- **Less reliable at first.** 3 of 23 answers to the new prompt did not match the answer schema, against 0 of 20 for
  the old one (network failures aside); in a build that would have stopped it. The build now asks once more when an
  answer does not match the schema, and counts both calls. A second bad answer still stops the build.

**Read this as an upper bound.** The prompt was written after looking at these ten builds' gaps, and it was measured
on the same ten. The fair test is on builds it has not seen; the second run below is that test.

## A second run: ten new briefs (13 November)

Ten new briefs (`evals/live-build/run-2/briefs.json`), two per domain, on topics the first run did not use, went through
the same runner with the new Model B prompt and the fixes above. Four were built to make the first code wrong, each
hinging on a rule code often gets wrong even when it is stated: a hospital stay across a daylight-saving night (12),
a GPA rounded half to even (14), loan due dates from the 31st (17), and a delivery date over a cutoff, a weekend and a
holiday (20). Every example in the briefs was worked out by hand first.

- **All 10 finished and all passed first time,** acceptance and unit tests, with no fix round. **$3.71 in all**, $0.26
  to $0.53 a build (mean $0.37, against $0.35 before), 11 to 36 minutes with five at once.
- **The traps did not spring.** The pipeline settled each hard rule before any code was written. For the GPA, the PRD
  and contract chose decimal strings ("3.7"), so the code never touched floating point. Model B's acceptance tests went
  straight at each trap: 9 of 12's 16 cases involve the clock changes, 12 of 17's are month ends, and every one of
  20's involves the cutoff or a holiday.
- **The four trap builds are right, checked independently.** `npm run live-build-trap-check` runs each one beside a
  reference written from its brief, on 14,671 generated inputs (daylight-saving nights, exact halves, month ends and
  leap years, cutoffs and holidays). There were 0 disagreements. The check is not blind: with `--self-test` it is
  given the naive code a model might write (wall-clock subtraction, `Math.round`, `setUTCMonth`, no holidays) and
  finds 351, 57, 947 and 520 disagreements.
- **The new Model B prompt held up on briefs it had not seen.** Every build got the full 16 cases. On their own,
  Model B's acceptance tests caught 75% of 229 mutants, against 63% on the first run (both counting every mutant);
  Model A's unit tests caught 72%, and the two together 77%. On the first run Model B's tests added nothing to Model
  A's; here they caught the most of either suite. Leaving out the 28 mutants that can never change a result, the
  tests caught 88% (176 of 201), against 79% on the first run (see below).
- **No answer needed the retry,** and the runner, tidied since the first run, worked unchanged.
- **Mutation testing needed one fix.** In 20, two mutants made a day-by-day loop endless and stalled the run. The
  script now falls back to one mutant per process with a 10-second limit, counting a timeout as caught, as a test
  runner would. On the first run's 208 mutants the fallback gives the same answer as the normal path for every one.

**The 53 survivors, sorted** (`npm run live-build-survivors -- evals/live-build/run-2`, on 56,036 inputs):

| Verdict | Count | What it is |
| --- | --- | --- |
| Gap, ordinary input | 2 | 14: a whole-number string such as `"1"` read as `0.1` (no test mixes `"1"` with `"4.0"`); 16: a rebate whose tenths of a cent come to exactly 49, which the mutant rounds up (`50000.83` gives `800.03` instead of `800.02`) |
| Gap, extreme input | 4 | 17: the leap rule for years divisible by 400 (February 2000, 1600 or 2400); 19: the code's `1e-9` float tolerance, which only a weight within a billionth of a kilogram of a half kilogram can show |
| Gap, invalid input only | 19 | 8 of them are inputs the contract leaves open: 15's order or case size of 0 or less (6) and 16's exact half cent (2). The rest give a different error for `null`, a missing field, or an hour of 24 or a minute of 60 |
| Equivalent | 28 | Can never change a result, with the reason for each in `evals/live-build/run-2/survivors-equivalent.json` |
| No difference found | 0 | |

None of the first run's four open gaps has a counterpart here. Two of them were inputs the PRD left open, and in this
run the contract said so in writing (16's half cent, 15's values of 0 or less), so they count as invalid input, not as
gaps. The other two were small values next to a boundary (a principal of 1, a carton of 1 kg); this run's two ordinary
gaps are of other kinds, an input form and one remainder. Both are cheap to close: one more acceptance case each.

So the fix-round path has still never run on live output: across 22 live builds, every first run has passed. Briefs
that state a hard rule plainly do not make the code fail, because the panel and contract settle the rule first. To
exercise the path live would take a fault the pipeline cannot see coming, for example code deliberately broken before
the first run. The path itself is covered by the build tests with scripted models.

## What this does not show

- **No build failed.** The red-run and fix-round path has never run on live output. Four briefs built to make the
  first code wrong (the second run) did not: the pipeline settled each hard rule before any code was written.
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
  operators are simple ones. The gaps were found by comparing on generated inputs, so a gap the inputs miss would be
  counted as equivalent only if the written reason also holds; one survivor of the first run is left unproven.

## Files

| What | Where |
| --- | --- |
| The ten briefs | `evals/live-build/briefs.json` |
| One full record per build: the panel, every build stage, every call's cost | `evals/live-build/records/` |
| The results in one file | `evals/live-build/results-2026-11-12.json` |
| The runner | `scripts/live-build-dry-run.mjs` |
| The second run: briefs, records, results, mutation testing, the 53 survivors sorted, and the independent check of the four trap builds | `evals/live-build/run-2/` (`npm run live-build-mutation -- evals/live-build/run-2/records`; `npm run live-build-survivors -- evals/live-build/run-2`; `npm run live-build-trap-check`, all free) |
| Mutation testing on the ten builds: every mutant, which test caught it, the survivors | `evals/live-build/mutation-2026-11-12.json` (`npm run live-build-mutation`, free) |
| Model B's test steps re-run with the old and new prompt (40 answers), the failures, and their scores | `evals/live-build/acceptance-prompt/`, `evals/live-build/acceptance-score-2026-11-13.json` (`npm run acceptance-eval`, about $0.80; `npm run acceptance-score`, free) |
| The 69 survivors sorted: each gap with the input that shows it, each equivalent mutant with its reason | `evals/live-build/survivors-2026-11-12.json`, reasons in `evals/live-build/survivors-equivalent.json` (`npm run live-build-survivors`, free) |
| The rating kit: 29 findings, a blind sheet for each of two raters, a page per build, and the key | `evals/live-build/judging/` (`npm run judging-prepare`, then `npm run judging-analyze`) |

The runner in the repository is a tidied copy of the script that produced these results. It produced the second run
unchanged (`node scripts/live-build-dry-run.mjs evals/live-build/run-2/briefs.json`); a run of ten spends about $3.50
to $4.
