# The live build dry run (12 November 2026)

Ten real end-to-end builds on live models, to find out how the live build behaves outside the two runs we had
tried by hand. Everything below comes from the records in `evals/live-build/records/`. The runner is
`scripts/live-build-dry-run.mjs` (`npm run live-dry-run`).

## The short version

- All 10 builds finished. None failed, none stopped at its limit, and five at once caused no rate-limit errors.
- **Cost $0.25 to $0.45 a build, $3.48 in all** (mean $0.35). Each build had a hard limit of $0.75 and none came near it.
- **Time 8 to 33 minutes** with five running at once. A single build on its own took 16 to 17 minutes earlier.
- **Every build passed its tests on the first run.** No build needed a fix round, so the fix path has still not run
  live.
- **Reviewers raised a serious (P0) finding in 5 of the 10 builds**, before any code was run. Three builds had no
  finding at all.
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

## What the reviews caught

These are real defects in what the models wrote, found by the other model before any test ran. None is an arithmetic
slip.

- **A bug in a design (build 04).** The design's pseudo-code reset the streak count to 0 whenever it was not 3, so the
  count could never reach 3 and three of the acceptance criteria would fail.
- **A missing-data case (build 03).** The design read `exam[0]` whenever the exam list existed. An empty list exists,
  so `exam[0]` is undefined and the grade would be wrong whenever there was no exam.
- **A crash in code (build 05).** Model B's code review found that a value was a `BigInt` being added to a string,
  which throws a `TypeError` in JavaScript. Every valid line would have crashed.
- **A rounding fault (build 07).** The design added a small epsilon before rounding, which can push a result sitting
  just below a half-cent onto the boundary and change the interest by one cent.
- **A logic error (build 10).** Model B pointed out that dividing total weight by 1000 ignores that cartons cannot be
  split: 5 cartons of 400 kg is 3 pallets, not 2. The final check then found that three of the PRD's own rules
  disagreed about zero cartons.

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

## What this does not show

- **No build failed.** The red-run and fix-round path has never run on live output. To test it I would need briefs
  built to make a model's first code wrong.
- **Passing tests is weak evidence on its own.** The tests come from the PRD that the same pipeline wrote. They show
  the code matches the pipeline's reading of the brief, not the requester's intent. Reviewers raised a P0 in half the
  builds before any code ran, so first-run passes mostly reflect problems fixed upstream. Nobody reviewed the code
  quality.
- **The briefs are small.** Each is one pure function in a made-up domain, which is the kind of feature the sandbox
  and the contract step suit. A real change to an existing codebase is harder, and this run says nothing about it.
- **We did not judge the findings.** Whether each P0 was real, and whether any were false alarms, has not been
  checked. The examples above are ones where the described fault is clearly real.
- **It tests the pipeline, not the hosted site.** The builds ran on a local machine. Whether Railway can isolate the
  network is still unknown.
- **No mutation testing** was run on these builds.

## Files

| What | Where |
| --- | --- |
| The ten briefs | `evals/live-build/briefs.json` |
| One full record per build: the panel, every build stage, every call's cost | `evals/live-build/records/` |
| The results in one file | `evals/live-build/results-2026-11-12.json` |
| The runner | `scripts/live-build-dry-run.mjs` |

The runner in the repository is a tidied copy of the script that produced these results. It has not been run since, and
running it spends about $3.50.
