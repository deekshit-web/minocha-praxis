# Build 07-interest-days (Financial services)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Calculate simple interest owed on a loan for a date range. Interest is the principal times the annual rate times the number of days divided by 365. The start date counts, the end date does not. In a leap year the divisor is still 365. Round to 2 decimals.
```

## The facts it was given

```
Made-up example: 10,000.00 at 6% from 2026-03-01 to 2026-04-01 is 31 days: 50.96. From 2028-02-01 to 2028-03-01 is 29 days: 47.67.
```

## Findings to rate (F17, F18)

### F17 · Design review · rated P0

**Epsilon can mis-round cents**

Adding an epsilon before rounding can move a result just below a half-cent boundary onto that boundary and change interest by one cent. That breaks round-to-2-decimals for ordinary inputs, not only float noise. Round the true quotient with no epsilon nudge.

What the builder did: **applied**. Removed the epsilon. round2 now rounds the computed quotient directly to the nearest cent.

### F18 · Design review · rated P1

**Unconfirmed half rounding shipped**

The contract says the exact-half method waits on REQ-4, and REQ-4 says it still needs confirming. Choosing half away from zero ships an unconfirmed rule. The given examples are not exact halves, so they do not prove this choice. Hold it as with REQ-5.

What the builder did: **applied**. Dropped half away from zero. The exact-half rule is a marked stub held for REQ-4, like the REQ-5 items, and exact-half tests are deferred.

## What was reviewed

### The design Model A first wrote

```
Component: one pure function simpleInterest(input) in a single module. It has no I/O, no clock and no shared state. It runs in four steps: validate fields, count days, compute interest, round.
Validation: reject any key other than principal, annualRate, startDate or endDate with Error "unknown field: <name>". Dates must match YYYY-MM-DD and be real calendar dates; this check is my proposal and is not in the contract.
Day count: parse each date as UTC midnight with Date.UTC(y, m-1, d), then days = (end - start) / 86400000. UTC avoids daylight-saving drift. This gives start included and end excluded, so 2026-03-01 to 2026-04-01 = 31 and 2028-02-01 to 2028-03-01 = 29.
Interest: principal x annualRate x days / 365, with the divisor fixed at 365 even in leap years. Round once, at the end only. Checks: 10000 x 0.06 x 31 / 365 = 50.9589 -> 50.96, and 10000 x 0.06 x 29 / 365 = 47.6712 -> 47.67.
Rounding: put it in one helper, round2(x), so the exact-half method (REQ-4) can be changed in one place. Until confirmed, use half away from zero, applied with a small epsilon to absorb float error.
Data: input {principal, annualRate as a fraction, startDate, endDate}; output {days: integer, interest: number with 2 decimals}. Nothing is stored.
On hold (REQ-5): what happens when end is before start, and when principal or rate is zero or negative. Leave a marked stub and do not ship guessed behaviour.
File fence (proposed; the repo layout is not given): src/simpleInterest.js (new) and test/simpleInterest.test.js (new). No other files may change.
Tests: AC-1 (31 days, 50.96), AC-2 (29 days, 47.67, divisor 365), AC-3 (same date, 0 days, 0.00), the unknown-field error, and an invalid date string.
```
