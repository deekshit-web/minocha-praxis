# Build 04-attendance-streak (Education)

Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under
"What was reviewed" at the end of this page. All data is made up.

## The brief

```
Tell a counsellor when a student has missed 3 school days in a row. Weekends and school holidays do not count as school days and do not break a streak. Return the date the streak reached 3, or nothing.
```

## The facts it was given

```
Input is a list of school days in date order, each marked present or absent, with holidays already removed. Made-up example: absent on Thursday, Friday and the next Monday is a streak of 3 reached on Monday.
```

## Findings to rate (F08, F09, F10)

### F08 · Requirements: review of draft B · rated P1

**Multiple or longer streaks undefined**

The requirements do not say what to return if the list holds two separate runs of 3 or more absences. They also do not say whether a 4th or later consecutive absence alerts the counsellor again. The brief implies a single date. Specify the first date reached, or every date, and when alerts repeat.

The passage it points at:

> When absences reach 3 in a row, tell a counsellor and return the date the streak reached 3; otherwise return nothing.

What the builder did: **fixed**. REQ-4 now states only the first date a streak reached 3 is returned, with no repeat alert for a 4th+ absence or a later streak, flagged as an assumption; AC-3 and AC-4 test this.

### F09 · Requirements: review of draft B · rated P2

**AC-3 wording overly broad**

Read literally, AC-3 says any short run returns nothing, even when a separate run of 3 exists elsewhere in the same input. Reword it as: input with no run of 3 or more consecutive absences returns nothing.

The passage it points at:

> AC-3: Any run of fewer than 3 absences returns nothing.

What the builder did: **fixed**. Replaced with AC-5: empty input or input with no run of 3 or more consecutive absences returns nothing.

### F10 · Design review · rated P0

**Count reset prevents any streak**

Written as a separate sentence after the count-is-3 check, Otherwise sets count to 0 whenever the count is not 3. The first and second absences are cleared, so the count never reaches 3 and AC-1, AC-3 and AC-4 fail.

What the builder did: **applied**. The reset is now tied only to status "present". An absent day adds 1 and returns at 3, so the trace gives 1, 2, 3 and Monday for AC-1. AC-3 and AC-4 now pass, and AC-2 still resets.

## What was reviewed

### Draft B of the requirements

```
REQ-1: Input is a date-ordered list of school days, each marked present or absent, with holidays already removed.
REQ-2: A streak is consecutive absent school days; a present mark breaks it, and weekends and holidays do not count as school days and do not break it.
REQ-3: When absences reach 3 in a row, tell a counsellor and return the date the streak reached 3; otherwise return nothing.
AC-1: Absent Thursday, absent Friday, absent the next Monday returns Monday.
AC-2: Absent Thursday, absent Friday, present the next Monday returns nothing.
AC-3: Any run of fewer than 3 absences returns nothing.
```

### The design Model A first wrote

```
Component: one pure function firstThreeDayAbsenceStreak(days) in its own new module. No I/O, no date arithmetic, no calendar logic, because weekends and holidays are already removed (REQ-1).
Data in: an array of { date: "YYYY-MM-DD", status: "present" | "absent" } in date order. Data out: a date string copied from the matching entry, or null.
Algorithm: start count = 0. For each entry in order: if status is "absent", add 1 to count; if count is now 3, return that entry's date at once. Otherwise set count = 0. After the loop, return null.
Rules check: neighbouring entries are consecutive school days, so the weekend gap in AC-1 (Thu, Fri, Mon) never resets the count, and Monday is returned (REQ-2, AC-1). A present day resets the count (AC-2). Returning on the third absence gives Monday, not Tuesday (AC-3), and the first run only (AC-4, REQ-4). An empty list or no run of 3 gives null (AC-5).
Out of scope: how the counsellor is notified (REQ-3). The caller decides what to do with a non-null result.
Tests: one unit test per AC-1 to AC-5, using made-up dates only.
File fence (proposed paths, since the repo layout is not given and must be confirmed): new src/attendance/firstThreeDayAbsenceStreak.js and new src/attendance/firstThreeDayAbsenceStreak.test.js. No other file may change.
Open points to confirm: the ISO date format and null for nothing (both contract choices), REQ-4 first-date-only, and whether a status other than "present" or "absent" should throw an error. The proposal is to throw rather than guess.
```
