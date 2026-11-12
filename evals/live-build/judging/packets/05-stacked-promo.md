# Build 05-stacked-promo (FMCG)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Price a promotion where a 10% discount and a buy-3-get-1-free offer can both apply to the same product line. Return the line total.
```

## The facts it was given

```
A line has sku, units and unitPrice. Made-up example: 8 units at 5.00 normal price is 40.00.
```

## Findings to rate (F11, F12, F13, F14, F15, F16)

### F11 · Requirements: review of draft A · rated P1

**False confirmation of free-unit rule**

AC-3 says equal totals for 7 and 8 units confirm that the free unit must already be on the line. That equality only follows from the unconfirmed floor(units/4) assumption in REQ-2. It does not establish the rule.

The passage it points at:

> This is the same as 8 units, which confirms the 4th unit must be on the line to be free.

What the builder did: **fixed**. AC-3 no longer claims that the equal totals confirm the free-unit rule. It now says the result follows from the REQ-2 assumption and is not evidence for it.

### F12 · Requirements: review of draft B · rated P1

**No rounding rule for discount**

Taking 10% off can produce fractions of a cent, for example 0.045 for one unit at 0.05. The draft does not say when to round, to how many decimals, or how. Different implementations could then return different line totals.

The passage it points at:

> apply 10% to the paid amount and return that figure as the line total

What the builder did: **fixed**. REQ-1 sets one rounding step at the end, to 2 decimals, assuming half-up pending confirmation. AC-5 tests the 0.045 case and expects 0.05.

### F13 · Requirements: review of draft B · rated P2

**No leftover or small-quantity criteria**

AC-1 only tests a multiple of four. Add criteria for leftover units, for example 7 units at 5.00: 1 free, 6 paid, 30.00, total 27.00. Also add one for fewer than four units and one for zero or invalid units.

The passage it points at:

> leftover units are charged.

What the builder did: **fixed**. Added criteria for leftover units (AC-3, 7 units gives 27.00), for fewer than four units (AC-2, 3 units gives 13.50), and for zero and invalid units (AC-4).

### F14 · Requirements: final check of the merged document · rated P0

**Example skips discount math**

One unit at 0.05 has a normal price of 0.05, not 0.045. The value 0.045 appears only after the 10 percent discount (0.05 x 0.90). The example states a wrong figure for those inputs.

The passage it points at:

> For example, 1 unit at 0.05 gives 0.045, which rounds to 0.05.

What the builder did: **fixed**. Real issue: the REQ-1 example went from 1 unit at 0.05 straight to 0.045 and skipped the discount step. It now gives the normal price of 0.05, then shows the 10% discount (0.05 x 0.90 = 0.045) before rounding to 0.05. The final result was already correct, and it matches AC-5, so P0 overstates the severity. Nothing else was changed.

### F15 · Design review · rated P2

**Floating-point failure claim wrong**

Binary 0.05 times 0.90 is slightly above 0.045, not 0.0449999..., so half-up still gives 0.05 and does not fail AC-5. Avoiding binary floating point is still sound, but this sentence states a wrong result.

What the builder did: **applied**. Removed the wrong claim. Binary 0.05 x 0.90 is about 0.045000000000000005, which still rounds to 0.05. The arithmetic line now gives a correct example of a float failing half-up: 1.005 is stored as 1.00499999... and rounds to 1.00. The scaled-integer approach and the AC-5 cents example are unchanged.

### F16 · Code review · rated P0

**Line total conversion throws**

whole is a BigInt, and BigInt plus a string throws TypeError in JavaScript. Every valid line, including AC-1 through AC-5, crashes here and never returns lineTotal.

What the builder did: **declined**. BigInt + string does not throw in JavaScript; the BigInt is converted to its string form and concatenated. Only mixing BigInt with Number in arithmetic throws TypeError. For AC-1, cents = 2700n, so whole + '.' + rest gives "27.00" and Number(...) gives 27. AC-5 traced: num = 1*5*9*100 = 4500, den = 100*10 = 1000, q = 4, r = 500, so it rounds half-up to 5 cents, giving 0.05. AC-2 (13.50), AC-3 (27.00) and AC-4 (0.00) also hold. Code is unchanged apart from a clarifying comment.

## What was reviewed

### Draft A of the requirements

```
REQ-1 Input is one line with sku, units (whole number, 0 or more) and unitPrice (0 or more). Output is the line total in the same currency, rounded once at the end to 2 decimals. The rounding rule is not in the brief; assume half-up and confirm with the requester.
REQ-2 Buy-3-get-1-free: free units = floor(units / 4), counted within the units on the line, so every 4th unit is free. This reading is an assumption; the brief does not say whether the free unit is part of the line or added on top.
REQ-3 When both promotions apply, line total = (units - free units) x unitPrice x 0.90. The 10% discount applies only to paid units. This order is an assumption to confirm: discounting the gross first and then removing free units at full price gives a different, lower total (26.00 instead of 27.00 in AC-1).
REQ-4 If units < 4, only the 10% discount applies. Reject negative units or a negative unitPrice with an error, and return no total.
AC-1 8 units at 5.00 (normal 40.00): free = 2, paid = 6, 6 x 5.00 = 30.00, x 0.90 = 27.00 line total.
AC-2 3 units at 5.00: free = 0, 15.00 x 0.90 = 13.50 line total.
AC-3 7 units at 5.00: free = 1, paid = 6, line total 27.00. This is the same as 8 units, which confirms the 4th unit must be on the line to be free.
AC-4 0 units at 5.00 returns 0.00. Units of -1 is rejected with an error.
```

### Draft B of the requirements

```
REQ-1: A line has sku, units and unitPrice, and a 10% discount and buy-3-get-1-free may both apply to that same line.
REQ-2: Normal price before either offer is units times unitPrice.
REQ-3: Buy-3-get-1-free charges three units and waives one unit in each complete set of four; leftover units are charged.
REQ-4: After free units are removed, apply 10% to the paid amount and return that figure as the line total.
AC-1: 8 units at 5.00 have normal price 40.00, two free units and six paid units, paid amount 30.00, line total 27.00.
```

### The merged requirements, before the final fix

```
REQ-1 Input is one line with sku, units (whole number, 0 or more) and unitPrice (0 or more). Both the 10% discount and buy-3-get-1-free may apply to the same line. The normal price is units x unitPrice. Output is the line total in the same currency, rounded once at the end to 2 decimals. The rounding rule is not in the brief; assume half-up and confirm with the requester. For example, 1 unit at 0.05 gives 0.045, which rounds to 0.05.
REQ-2 Buy-3-get-1-free: free units = floor(units / 4), counted within the units on the line. One unit is waived in each complete set of four, and leftover units are charged. This reading is an assumption; the brief does not say whether the free unit is part of the line or added on top.
REQ-3 When both promotions apply, line total = (units - free units) x unitPrice x 0.90. The 10% discount applies only to paid units. This order is an assumption to confirm. Discounting the gross first and then removing free units at full price gives a lower total (26.00 instead of 27.00 in AC-1).
REQ-4 If units < 4, only the 10% discount applies. Reject negative units or a negative unitPrice with an error, and return no total.
AC-1 8 units at 5.00 (normal 40.00): free = 2, paid = 6, 6 x 5.00 = 30.00, x 0.90 = 27.00 line total.
AC-2 3 units at 5.00: free = 0, 15.00 x 0.90 = 13.50 line total.
AC-3 7 units at 5.00: free = 1, paid = 6, 30.00 x 0.90 = 27.00 line total. This follows the REQ-2 assumption and is not evidence for it.
AC-4 0 units at 5.00 returns 0.00. Units of -1 is rejected with an error.
AC-5 1 unit at 0.05: 0.05 x 0.90 = 0.045, which rounds half-up to 0.05 line total.
```

### The design Model A first wrote

```
Component: one pure function priceLine(line) in a new module, with no I/O and no shared state; it follows the module contract exactly.
Steps: 1) validate; 2) normalPrice = units x unitPrice, unrounded; 3) freeUnits = floor(units / 4); 4) paidUnits = units - freeUnits; 5) lineTotal = round2HalfUp(paidUnits x unitPrice x 0.90); 6) return { sku, normalPrice, freeUnits, paidUnits, lineTotal }. Units < 4 needs no special case because freeUnits is then 0.
Validation: throw Error("invalid field: units") if units is negative, not a whole number or not finite. Throw Error("invalid field: unitPrice") if unitPrice is negative or not finite. REQ-4 names only negatives; rejecting fractional units follows the contract's whole-number rule and needs requester confirmation.
Arithmetic: compute lineTotal from a decimal or scaled-integer value, not binary floating point. In floating point, 0.05 x 0.90 gives 0.0449999..., which rounds to 0.04 and fails AC-5. Example: 5 cents x 90 / 100 = 4.5 cents, which rounds half-up to 5 cents, so 0.05.
Rounding: round half-up exactly once, at the end. The half-up rule and the discount order (applied to paid units only) are assumptions still to confirm, so keep each in one named constant or helper that is easy to change.
Data: input { sku, units, unitPrice }. Constants: DISCOUNT_RATE = 0.10, BUNDLE_SIZE = 4, FREE_PER_BUNDLE = 1. No persistence and no config files.
Checked numbers: AC-1 8 units -> free 2, paid 6, 30.00 x 0.90 = 27.00. AC-2 3 units -> 13.50. AC-3 7 units -> free 1, 27.00. AC-4 0 units -> 0.00; -1 units throws. AC-5 -> 0.05. Discounting first instead would give 26.00 for AC-1.
File fence (only these may change): src/pricing/priceLine.js (new); test/pricing/priceLine.test.js (new), covering AC-1 to AC-5 plus fractional units and a negative unitPrice. These paths are proposed; the real repo layout is not in the facts, so confirm them before building.
Out of scope: other promotions, multi-line baskets, currency conversion, and any file outside the fence.
```

### The code Model A first wrote

```
(() => {
  const DISCOUNT_RATE = 0.1;
  const BUNDLE_SIZE = 4;
  const FREE_PER_BUNDLE = 1;
  const toScaled = (x) => {
    const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(x));
    if (!m) throw new Error("unparseable number");
    const frac = m[2] || "";
    const exp = m[3] ? parseInt(m[3], 10) : 0;
    let digits = BigInt(m[1] + frac);
    let scale = frac.length - exp;
    if (scale < 0) {
      digits *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return { digits, scale: BigInt(scale) };
  };
  const roundHalfUpDiv = (num, den) => {
    const q = num / den;
    const r = num % den;
    return 2n * r >= den ? q + 1n : q;
  };
  const centsToNumber = (cents) => {
    const whole = cents / 100n;
    const rest = String(cents % 100n).padStart(2, "0");
    return Number(whole + "." + rest);
  };
  const discountedPaidCents = (paidUnits, unitPrice) => {
    const p = toScaled(unitPrice);
    const d = toScaled(DISCOUNT_RATE);
    const dDen = 10n ** d.scale;
    const factorNum = dDen - d.digits;
    const num = BigInt(paidUnits) * p.digits * factorNum * 100n;
    const den = 10n ** p.scale * dDen;
    return roundHalfUpDiv(num, den);
  };
  const priceLine = (line) => {
    const { sku, units, unitPrice } = line || {};
    if (typeof units !== "number" || !Number.isFinite(units) || !Number.isInteger(units) || units < 0) {
      throw new Error("invalid field: units");
    }
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("invalid field: unitPrice");
    }
    const u = units === 0 ? 0 : units;
    const price = unitPrice === 0 ? 0 : unitPrice;
    const normalPrice = u * price;
    const freeUnits = Math.floor(u / BUNDLE_SIZE) * FREE_PER_BUNDLE;
    const paidUnits = u - freeUnits;
    const lineTotal = centsToNumber(discountedPaidCents(paidUnits, price));
    return { sku, normalPrice, freeUnits, paidUnits, lineTotal };
  };
  return { priceLine };
})()
```
