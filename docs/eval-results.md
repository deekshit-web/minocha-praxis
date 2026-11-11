# What the panel eval measured

Run in November 2026 on Opus 5.5 (Model A) and Grok 4.7 (Model B). Every number below comes from real, metered
calls. Results are under `.claude/hillclimb/prd-planted/` and `.claude/hillclimb/prd-briefs/`; re-run with
`npm run eval-prd` and `npm run self-review`. Total spend across all three tests, judges included, is about $42.

## Part A: does a reviewer catch a known defect?

36 PRDs, each with one planted defect (a wrong deadline, a wrong CARC action, a missing role check, ...).

| Reviewer | Caught | Rated P0 |
|---|---|---|
| Claude | 35 / 36 | 35 |
| Grok | 36 / 36 | 36 |

Both models find a planted defect almost every time. The 8 "clean" controls turned out to contain a real flaw
(CO-16 AC-4), so the false-alarm rate could not be measured.

## Part B: which setup writes the best PRD?

8 briefs, two judges (Claude Sonnet 5 and Grok 4.7) scoring a checklist per brief and comparing each PRD blind
against the single draft.

| Setup | Checklist | Gates pass | Beats single draft | Cost / brief | Time |
|---|---|---|---|---|---|
| Single draft (Claude) | 0.812 | 88% | n/a | $0.15 | 0.9 min |
| Self-review (Claude) | 0.805 | 100% | 0.81 | $0.52 | 3.0 min |
| Panel, all Claude | 0.852 | 100% | 0.81 | $0.89 | 5.4 min |
| Panel, Claude + Grok | 0.844 | 100% | 0.56 | $0.82 | 16.0 min |
| v4: Claude panel, strict severity, Grok final review | 0.852 | 100% | 0.75 | $1.23 | 13.5 min |

- Any review step fixes the gate failures the single draft has.
- On the judges' measures the all-Claude panel and v4 tie, and both beat the mixed Claude + Grok panel. Grok as a
  judge preferred the all-Claude panel too, so this is not Claude preferring its own writing.
- With 8 briefs, differences under about 0.05 on the checklist are noise.

## What the final Grok review found

In v4, the strict all-Claude panel had already reviewed and merged each PRD. Grok then reviewed the merged PRD
once. It raised P0s on **all 8 briefs: 16 P0s and 22 P1s**, and Claude revised every one. Examples:

- a scenario expected a deadline that did not match the fixture table;
- a requirement said "aggregate counts only" while a test expected individual claim ids;
- the same screen was specified two different ways;
- work was assigned to a role the policy file does not give it.

Claude accepted most findings and rejected some with reasons. The checklist judges barely moved, because the
checklist asks whether the PRD covers the brief, not whether it is consistent with itself and the policy files.
That is the gap the final review fills, and the eval does not yet score it.

## Self-review: does Claude rate its own mistakes as seriously?

Five real Opus 5.5 artifacts in which Grok had found a P0, reviewed by Claude in a fresh context with Grok's
instructions (`evals/prd-panel/self-review.json`, $0.17).

Claude found 5 of the 6 problems but rated 4 of them lower than Grok did (for example, the wrong 18% trial figure
as P2). Only one stayed a P0. Telling Claude "a wrong figure is P0" did not close this in v4 either: the strict
Claude reviewers still passed documents in which Grok found P0s.

## What this means for the pipeline

1. Default to the all-Claude panel: it scores as well as anything and is the fastest review setup.
2. Keep one independent review from a different vendor on the final document before a person approves it. It
   is where the serious faults are found. It adds about $0.35 and 8 minutes, which can run while the person reads.
3. Route low-risk work to one model and a person (Model C decides).
4. Next for the eval: add a consistency check to the judges, so the score counts what the final review catches.
