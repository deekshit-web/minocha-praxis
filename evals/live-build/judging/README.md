# Rating the findings

Ten live builds raised 29 findings in all. This folder lets two people rate them, each on their own, so that we can
measure how often a reviewer raises a finding that is not a real problem (a false alarm), and how well two people agree.

## How to rate

1. Copy nothing. Open your own sheet, `rater-1.csv` or `rater-2.csv`, in a spreadsheet or a text editor.
2. For each finding, read its page in `packets/` (one per build). The brief and facts are at the top. The text the
   finding is about is at the end.
3. Fill in the last four columns. Do **not** look at the other rater's sheet, `key.json` or any report first.

| Column | Answer with | Meaning |
| --- | --- | --- |
| `real` | `yes`, `partly`, `no` or `unsure` | **yes**: the problem exists as the reviewer describes. **partly**: something is wrong, but the description is wrong or overstated. **no**: a false alarm; the text is right, or the reviewer misread it. |
| `severity_check` | `right`, `too_high` or `too_low` | P0 would give a wrong result, break a rule or be a security problem. P1 should be fixed. P2 is optional. |
| `resolution_check` | `good`, `bad` or `unsure` | Was the builder's response right: a proper fix, or a sound reason for declining? |
| `comment` | free text | Anything the others should know. Required when you answer `partly` or `no`. |

Check claims yourself where you can. For code, run it. In the earlier write-up a claim about JavaScript was taken on trust
and was wrong.

## When both have finished

`npm run judging-analyze` reads the two sheets and writes `report.md`: the false-alarm rate with a 95% interval, by
severity, stage and reviewing model, how well the two raters agree, and the findings they disagree on.

The findings are not a random sample of everything a reviewer might say. They come from ten small builds. Read the
report with that in mind.
