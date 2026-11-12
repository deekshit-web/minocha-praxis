# Build 02-duplicate-claims (Healthcare)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Flag duplicate claims in a batch so a specialist can review them. Two claims are duplicates when they look the same.
```

## The facts it was given

```
A claim has claimId, patientRef (a made-up code), serviceDate, procedureCode and amount. All data is made up.
```

## Findings to rate (F01, F02, F03)

### F01 · Requirements: review of draft B · rated P1

**Duplicate criterion left undefined**

The brief's phrase 'look the same' is copied without defining which fields must match or how closely. The requirement cannot be built or tested consistently. Record this as an open question for the visitor rather than restating it as a requirement.

The passage it points at:

> REQ-2: Two claims are duplicates when they look the same. Use no other duplicate rule.

What the builder did: **fixed**. REQ-2 defines 'look the same' as an exact match on patientRef, serviceDate, procedureCode and amount, and labels this as an assumption the visitor must confirm. REQ-5 records near-matches as an open question.

### F02 · Requirements: review of draft B · rated P1

**AC-1 silently invents exact-match rule**

AC-1 treats 'look the same' as all five fields being identical, including claimId. That is a second rule, which REQ-2 forbids. It also means resubmitted claims with new claimIds would never be flagged. State the assumption explicitly or ask the visitor.

The passage it points at:

> a second claim with those same five values. They look the same, so flag both for review.

What the builder did: **fixed**. The exact-match rule is now stated as an explicit assumption. claimId is excluded from the comparison, and AC-1 shows that two claims with different claimIds are still flagged, so resubmitted claims are caught.

### F03 · Requirements: review of draft B · rated P2

**AC-2 changes two fields**

The non-match claim differs in claimId (2 vs 1) as well as amount, yet only amount is named as the reason. Varying a single field would make the test show clearly which difference prevents the flag.

The passage it points at:

> amount 80 is not amount 100, so they do not look the same and are not flagged.

What the builder did: **fixed**. AC-2 now differs only in amount among the compared fields. claimId is not compared, so its difference does not affect the result.

## What was reviewed

### Draft B of the requirements

```
REQ-1: Read a batch of claims. Each claim has claimId, patientRef, serviceDate, procedureCode and amount. patientRef is a made-up code. All data is made up.
REQ-2: Two claims are duplicates when they look the same. Use no other duplicate rule.
REQ-3: Flag the duplicate claims in that batch so a specialist can review them.
AC-1: Made-up exact match, because the brief has no sample values: claimId 1, patientRef REF1, serviceDate 2024-06-01, procedureCode PC100, amount 100, and a second claim with those same five values. They look the same, so flag both for review.
AC-2: Made-up non-match: the first claim in AC-1 and a claim with claimId 2, patientRef REF1, serviceDate 2024-06-01, procedureCode PC100, amount 80. amount 80 is not amount 100, so they do not look the same and are not flagged.
```
