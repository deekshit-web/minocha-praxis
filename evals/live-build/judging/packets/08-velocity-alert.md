# Build 08-velocity-alert (Financial services)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Raise an alert when an account makes more than 5 card payments within any 10 minute period. Return the time of the payment that caused the alert. Payments exactly 10 minutes apart are in different periods.
```

## The facts it was given

```
Input is a list of payment times in order, in UTC. Made-up example: payments at 10:00, 10:02, 10:04, 10:06, 10:08, 10:09 alert at 10:09. Payments at 10:00 and 10:10 are not in the same period.
```

## Findings to rate (F19, F20)

### F19 · Requirements: review of draft B · rated P1

**Repeat and no-alert behaviour undefined**

The requirements do not say whether only the first triggering payment is returned or every later payment in the same window also alerts, nor what is returned when no alert occurs. These are open questions for the visitor, not facts to invent, but they should be resolved before approval.

The passage it points at:

> REQ-4: Return the time of the payment that caused the alert.

What the builder did: **fixed**. REQ-4 states that no alert is raised when no payment makes a 6th in one period. Whether later payments raise further alerts is recorded as an open question for the requester rather than invented, and it must be answered before approval.

### F20 · Requirements: review of draft B · rated P2

**AC-2 lacks observable outcome**

AC-2 restates the boundary rule but gives no expected system result, so it cannot be tested directly. It could be tied to an alert or no-alert outcome, using only the stated facts, for example by building a case on the AC-1 sequence.

The passage it points at:

> AC-2: Payments at 10:00 and 10:10 are not in the same period.

What the builder did: **fixed**. B's AC-2 and A's matching AC-4 are replaced by a testable case built on the AC-1 sequence. With 10:10 in place of 10:09 the expected result is no alert, because 10:00 and 10:10 are in different periods and the period ending at 10:10 holds only 5 payments.

## What was reviewed

### Draft B of the requirements

```
REQ-1: Input is an ordered list of card payment times in UTC for an account.
REQ-2: Raise an alert when the account makes more than 5 card payments within any 10 minute period.
REQ-3: Payments exactly 10 minutes apart are in different periods.
REQ-4: Return the time of the payment that caused the alert.
AC-1: Payments at 10:00, 10:02, 10:04, 10:06, 10:08, 10:09 alert at 10:09.
AC-2: Payments at 10:00 and 10:10 are not in the same period.
```
