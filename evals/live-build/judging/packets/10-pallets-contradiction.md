# Build 10-pallets-contradiction (Logistics)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Work out how many pallets are needed for a number of cartons. A pallet holds at most 48 cartons and at most 1000 kg. Every carton weighs the same. Return the number of pallets, rounded up.
```

## The facts it was given

```
Made-up example: 100 cartons of 8 kg needs 2 pallets. (Check this against the rules.)
```

## Findings to rate (F21, F22, F23, F24, F25, F26, F27, F28, F29)

### F21 · Requirements: review of draft A · rated P0

**Stated quotient is wrong**

100 divided by 48 equals 2.0833..., not 2.08. The ceiling is still 3, so the pallet count is right, but the equality states a wrong figure.

The passage it points at:

> 100 / 48 = 2.08

What the builder did: **fixed**. The quotient is now written as 100 / 48 = 2.083..., which still rounds up to 3.

### F22 · Requirements: review of draft A · rated P2

**Example blamed on brief**

The brief states only the 48-carton and 1000 kg limits and rounding up. The answer of 2 is a made-up fact to check, not a brief example. The correction to 3 is right; the source name is not.

The passage it points at:

> The brief's example answer of 2 is wrong

What the builder did: **fixed**. The 2-pallet answer is now credited to the made-up example, not the brief.

### F23 · Requirements: review of draft B · rated P0

**Weight rule ignores indivisible cartons**

Cartons cannot be split across pallets. With 5 cartons of 400 kg, total 2000/1000 gives 2, but each pallet fits only 2 cartons (800 kg), so 3 pallets are needed. Use per-pallet capacity min(48, floor(1000/weight)), then round up count divided by that.

The passage it points at:

> Take carton count divided by 48 and total kg divided by 1000, round each up, and return the greater whole number.

What the builder did: **fixed**. Draft B's total-weight rule is replaced by c = min(48, floor(1000 / w)) and ceil(n / c). AC-3 checks 5 cartons at 400 kg, which gives 3 pallets.

### F24 · Requirements: review of draft B · rated P1

**Edge and invalid inputs unspecified**

There is no requirement for zero cartons, zero or negative weight, or a single carton over 1000 kg, which can never be palletised. Behaviour for these inputs should be defined before approval.

The passage it points at:

> Given a carton count and one weight shared by every carton, return how many pallets are needed.

What the builder did: **fixed**. REQ-5 and AC-5 now define the result for zero cartons, a zero or negative weight, a carton over 1000 kg and invalid inputs.

### F25 · Requirements: review of draft B · rated P2

**Example misattributed to brief**

The 2-pallet answer comes from the made-up example in the facts, not from the brief. The correction itself is right; only the attribution is wrong.

The passage it points at:

> The brief answer of 2 is wrong

What the builder did: **fixed**. The 2-pallet answer is attributed to the made-up example in the facts.

### F26 · Requirements: final check of the merged document · rated P0

**Zero carton count contradiction**

REQ-5 rejects zero carton counts with an error. REQ-1 allows n of zero or more, REQ-4 returns 0 when n is 0, and AC-5 expects 0 pallets for 0 cartons at 8 kg. One of these rules is wrong and they cannot be implemented together.

The passage it points at:

> Zero, negative, non-whole carton counts and non-numeric inputs are also rejected with an error.

What the builder did: **fixed**. The finding is correct. REQ-5 rejected zero carton counts, but REQ-1, REQ-4 and AC-5 all allow n = 0 and expect 0 pallets. I removed zero counts from the REQ-5 rejection list. REQ-5 now rejects negative or non-whole counts. In the same sentence, it states that weights of 0 kg or less are rejected. This keeps REQ-5 consistent with REQ-1 (w > 0) and with the AC-5 error for a weight of 0 kg. Nothing else was changed.

### F27 · Design review · rated P0

**Float floor overloads pallet**

For the next double above 1000/9, 1000/w rounds to 9, so c is 9, but nine cartons weigh 1000+2^-45 kg. The guard only adds a carton when a float product looks legal, and never reduces an overweight c. That breaks the 1000 kg cap.

What the builder did: **applied**. The old guard could only raise c. c is now corrected both ways with an exact c * w <= 1000 test (error-free product), so a float floor can never overload a pallet. A test for the double just above 1000/9 is added.

### F28 · Design review · rated P1

**Open point reopens settled case**

AC-1 already requires 3 pallets for 100 cartons at 8 kg and says 2 is wrong because 2 pallets hold at most 96. Line 5 agrees. Asking the requester to confirm 3 can still overturn a closed rule and fail AC-1.

What the builder did: **applied**. The open point is removed. AC-1 already settles 3 pallets, and the requester cannot reopen it.

### F29 · Design review · rated P1

**Infinity uses wrong error**

A weight greater than 1000 must throw carton too heavy for a pallet. Infinity is a number greater than 1000, so that message applies. The finite check rejects it first as invalid cartonWeightKg, which breaks the contract's error split.

What the builder did: **applied**. The finite check is dropped. Only non-numbers, NaN and weights of 0 or less are "invalid cartonWeightKg". Infinity is above 1000, so it gets "carton too heavy for a pallet", and a test is added.

## What was reviewed

### Draft A of the requirements

```
REQ-1 Inputs are the number of cartons n (a whole number, 0 or more) and the weight per carton w in kg (greater than 0). Every carton has the same weight.
REQ-2 Cartons per pallet c = min(48, floor(1000 / w)). A pallet must never exceed 48 cartons or 1000 kg.
REQ-3 Output is pallets = ceil(n / c), a whole number. n = 0 returns 0.
REQ-4 If w > 1000 kg, c = 0 and no pallet can hold a carton, so return an error instead of a number. Negative or non-numeric inputs are also rejected with an error.
AC-1 Given 100 cartons at 8 kg, c = min(48, 125) = 48, and 100 / 48 = 2.08, which rounds up to 3 pallets. The brief's example answer of 2 is wrong, because 2 pallets hold at most 96 cartons.
AC-2 Given 90 cartons at 25 kg, c = min(48, 40) = 40 because weight is the limit, and 90 / 40 = 2.25, which rounds up to 3 pallets. A count-only calculation would wrongly give 2.
AC-3 Given 96 cartons at 8 kg, the result is exactly 2 pallets with no extra pallet. Given 97 cartons at 8 kg, the result is 3 pallets.
AC-4 Given 1 carton at 1001 kg, an error is returned. Given 0 cartons at 8 kg, the result is 0 pallets.
```

### Draft B of the requirements

```
REQ-1: Given a carton count and one weight shared by every carton, return how many pallets are needed.
REQ-2: One pallet holds at most 48 cartons and at most 1000 kg.
REQ-3: Take carton count divided by 48 and total kg divided by 1000, round each up, and return the greater whole number.
REQ-4: Total kg equals carton count times the weight of one carton.
AC-1: 100 cartons of 8 kg need 3 pallets: 100/48 rounds up to 3 and 800/1000 rounds up to 1.
AC-2: The brief answer of 2 is wrong: 2 pallets hold at most 96 cartons, so 100 cartons do not fit.
AC-3: 48 cartons of 20 kg need 1 pallet: 48 cartons and 960 kg both fit the limits.
AC-4: 49 cartons of 1 kg need 2 pallets by count, while 49 kg still fits the weight limit.
```

### The merged requirements, before the final fix

```
REQ-1 Inputs are the number of cartons n (a whole number, 0 or more) and the weight of one carton w in kg (greater than 0). Every carton weighs the same.
REQ-2 One pallet holds at most 48 cartons and at most 1000 kg. Cartons cannot be split across pallets.
REQ-3 Cartons per pallet c = min(48, floor(1000 / w)).
REQ-4 Output is pallets = ceil(n / c), a whole number. n = 0 returns 0.
REQ-5 If w > 1000 kg, c = 0 and no pallet can hold a carton, so return an error instead of a number. Zero, negative, non-whole carton counts and non-numeric inputs are also rejected with an error.
AC-1 Given 100 cartons at 8 kg, c = min(48, 125) = 48, and 100 / 48 = 2.083..., which rounds up to 3 pallets. The made-up example answer of 2 is wrong, because 2 pallets hold at most 96 cartons.
AC-2 Given 90 cartons at 25 kg, c = min(48, 40) = 40 because weight is the limit, and 90 / 40 = 2.25, which rounds up to 3 pallets. A count-only calculation would wrongly give 2.
AC-3 Given 5 cartons at 400 kg, c = min(48, 2) = 2, so 3 pallets are needed. Total weight alone (2000 kg) would wrongly give 2.
AC-4 Given 96 cartons at 8 kg, the result is exactly 2 pallets. Given 97 cartons at 8 kg, the result is 3 pallets. Given 48 cartons at 20 kg, the result is 1 pallet (960 kg).
AC-5 Given 1 carton at 1001 kg, an error is returned. Given 0 cartons at 8 kg, the result is 0 pallets. Given a weight of 0 kg, an error is returned.
```

### The design Model A first wrote

```
Design: palletsNeeded (plain text, 10 lines)
1. Component: one pure function palletsNeeded(input) in a single module. It has no I/O, no state and no dependencies. A unit test file sits beside it.
2. Data: input is { cartons, cartonWeightKg }. Output is { pallets, cartonsPerPallet }. Constants are MAX_CARTONS = 48 and MAX_KG = 1000.
3. Validation runs in this order and throws on the first failure. Unknown key: "unknown field: <name>". Absent cartons or cartonWeightKg: "missing field: <name>". cartons not a safe integer of 0 or more: "invalid cartons". cartonWeightKg not a finite number above 0 (this rejects NaN, Infinity and strings): "invalid cartonWeightKg". cartonWeightKg above 1000: "carton too heavy for a pallet".
4. Calculation: c = min(48, floor(1000 / w)). To guard against float error, if (c + 1) * w <= 1000 and c < 48, add 1 to c. Then pallets = ceil(n / c), so n = 0 gives 0. Because w <= 1000 is enforced first, c is always at least 1 and there is no divide by zero.
5. Checked against the rules: 100 at 8 kg gives c = 48 and 3 pallets, so the brief's example of 2 is wrong. 90 at 25 kg gives c = 40 and 3 pallets. 5 at 400 kg gives c = 2 and 3 pallets. 96 at 8 kg gives 2 pallets and 97 at 8 kg gives 3. 48 at 20 kg gives 1 pallet (960 kg). 1000 kg exactly gives c = 1. 1001 kg gives an error.
6. Tests: AC-1 to AC-5, every error message, the check order (for example, an unknown field plus a bad weight reports the unknown field), and the w = 1000 boundary.
7. File fence (only these may change): src/palletsNeeded.js (new) and test/palletsNeeded.test.js (new). Adjust the paths to the repo layout if it differs, but keep it to two files.
8. Out of fence: no other modules, configs or dependencies may change.
9. Open point: the requester should confirm that 3 pallets, not 2, is accepted for the 100 x 8 kg example.
```
