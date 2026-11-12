# Build 03-grade-weights (Education)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Calculate a student's final grade from weighted category scores. Homework counts 20%, quizzes 30%, the exam 50%. In the homework category the lowest score is dropped when there are 4 or more scores. Round the final grade to 1 decimal place.
```

## The facts it was given

```
Made-up example: homework 90, 80, 70, 100 (drop 70, average 90), quizzes 80 and 70 (average 75), exam 60. Final = 0.2*90 + 0.3*75 + 0.5*60 = 70.5. A category with no scores counts as 0.
```

## Findings to rate (F04, F05, F06, F07)

### F04 · Requirements: review of draft B · rated P2

**Rounding method not specified**

REQ-4 does not say how halves are rounded. A result such as 70.25 could become 70.3 (half up) or 70.2 (banker's rounding). The brief is silent, so this could be flagged as an open question.

The passage it points at:

> REQ-4: Round the final grade to 1 decimal place.

What the builder did: **fixed**. REQ-4 now flags half-rounding (70.25 to 70.3 or 70.2) as an open question for the requester.

### F05 · Requirements: review of draft B · rated P2

**No test for under-four homework**

No acceptance criterion checks that nothing is dropped when homework has fewer than 4 scores, or exactly which score is dropped when the lowest is tied. Adding one would confirm the threshold in REQ-2.

The passage it points at:

> REQ-2: If homework has 4 or more scores, drop the lowest score before averaging

What the builder did: **fixed**. AC-2 covers 3 homework scores with no drop (average 80, final 68.5). REQ-2 now says only one of tied lowest scores is dropped; the result is the same whichever copy is removed.

### F06 · Requirements: review of draft B · rated P2

**Rounding lacks acceptance criterion**

Both examples already land on one decimal, so no criterion actually tests REQ-4. An example that needs rounding would confirm the behavior.

The passage it points at:

> AC-2: With no quiz scores, the quiz category is 0, so the same homework and exam give 0.2*90 + 0.3*0 + 0.5*60 = 48.0.

What the builder did: **fixed**. AC-4 needs rounding: 16.333 + 21.15 + 38.5 = 75.983, shown as 76.0.

### F07 · Design review · rated P0

**Empty exam is not zero**

REQ-3 requires a category with no scores to count as 0. This line uses exam[0] whenever the exam array is present. An empty array is present, so exam[0] is undefined, not 0, and the final grade is wrong whenever there is no exam.

What the builder did: **applied**. examScore now uses exam.length > 0 ? exam[0] : 0, so an empty exam counts as 0 under REQ-3. Added an empty-exam test: 18 + 22.5 + 0 = 40.5.

## What was reviewed

### Draft B of the requirements

```
REQ-1: Final grade equals 0.2 times the homework category score plus 0.3 times the quiz category score plus 0.5 times the exam score.
REQ-2: If homework has 4 or more scores, drop the lowest score before averaging; quizzes are averaged with no drop.
REQ-3: A category with no scores counts as 0.
REQ-4: Round the final grade to 1 decimal place.
AC-1: Homework 90, 80, 70, 100 drops 70 and averages 90; quizzes 80 and 70 average 75; exam 60; final is 0.2*90 + 0.3*75 + 0.5*60 = 70.5.
AC-2: With no quiz scores, the quiz category is 0, so the same homework and exam give 0.2*90 + 0.3*0 + 0.5*60 = 48.0.
```

### The design Model A first wrote

```
Components: one pure module finalGrade(input) built from small helpers: validateInput (throws Error "unknown field: <name>" for any key other than homework, quizzes or exam), average(scores) (returns 0 for an empty list), homeworkAverage(scores) (drops one lowest score only when there are 4 or more), weightedTotal, and roundTo1 plus formatDisplay.
Data: input { homework: number[], quizzes: number[], exam: number[] }. Output { homeworkAverage, quizAverage, examScore, final, display, droppedHomework }. Weights are constants 0.2, 0.3 and 0.5, which total 1.0.
Homework: if length >= 4, droppedHomework = min(scores) and one instance is removed, even when tied (AC-1 drops 70). Otherwise droppedHomework = null and all scores are averaged (AC-2 averages to 80).
Empty category: average, or examScore, is 0 (REQ-3, AC-3 gives 18 + 0 + 30 = 48.0). examScore = exam[0] when the array is present, else 0.
Rounding: keep it in one function, roundTo1, so the pending exact-half rule (REQ-4) changes only that function. display = final.toFixed(1), giving "48.0" and "76.0" (AC-4 gives 16.333 + 21.15 + 38.5 = 75.983, which becomes 76.0).
Float care: compute the unrounded total in full precision and round only once at the end. Example values checked: 70.5, 68.5, 48.0 and 76.0 are all correct.
Open items for the contract owner: (1) behavior when exam has more than 1 score; (2) a missing field (treat as empty, or throw?); (3) scores outside 0 to 100 or non-numbers (no error is specified).
Tests: AC-1 to AC-4, the tied-lowest drop, the unknown-field error, and all categories empty (final 0, display "0.0"). No assertion for exact-half cases.
File fence (paths assumed, as no repo layout was given): src/grade/finalGrade.js (new) and test/grade/finalGrade.test.js (new). No other files may change.
```
