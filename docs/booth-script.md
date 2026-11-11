# Booth script: for a visitor who knows AI coding and testing

About 5 minutes. Site: https://kodiflex-foundry-production.up.railway.app

They have seen agents write code. What they have not seen is a reason to trust the code. Every beat below
answers one sceptical question with something on the screen. Let them drive whenever they want to.

## Before they arrive

- Open the site, choose **Technical** (top right), pick **Financial services → Ship a loan pre-qualification
  check**. Speed **60×**. Leave it on step 1.
- Shortcuts: **Space** play or pause, **A** approve, **N** next step, **R** restart, **T** plain or technical,
  **1–8** jump to a stage.

## 1. The hook (20 s)

> "Everyone shows an agent writing code. We show why you can trust what it wrote."

Point at the proof box: a real, metered run. Two models, $1.52, 21 minutes, and one model caught the other
calling a 17-day gap "within 14 days". Offer the run record download.

**If they ask what is real here:** the proof run is real. Model C's decisions run live on Jev. The code
checks and the tests are real code running in this browser. The drafts and reviews are a prepared replay, and
the page labels them that way.

## 2. Roles, not vendors (15 s)

Point at the three cards: Model A builds, Model B checks and comes from a different vendor, Model C decides.

> "Swap any model in. What matters is that the checker is independent of the builder, and the cheap decisions
> don't go to an expensive model."

## 3. A live decision (20 s)

Press **Space**. Route lights up: **Live decision · ~100 ms · $0.00002**.

> "That call just happened. A decision model, not an LLM: typed answers with calibrated confidence."

Click the Route step, then **Now try the router on a low-risk request**. The same live model gets a footer
typo fix and says **low · 0.97 → one model and a person**.

> "It isn't decoration: it tells risky work from trivial work, and only the risky work pays for two models."

## 4. Their turn (15 s)

It stops at **Your answers**: four questions with suggested answers. Have them press **Accept these answers**
(or **A**).

## 5. The catch (30 s)

Drafts are written apart ("cannot see each other"). These steps are a **recording of a real run**; the badge says
"Recorded live call", with its real time and cost. Click **A reviews B**: Model A found **2 findings** in Model B's
draft, one P1 (REQ-1 only tells an applicant the outcome when both rules pass, which contradicts the brief). Click
**B reviews A**: **0 findings**.

> "Nothing here is planted. These are real gaps one model found in the other's work, and the merge fixed them."

**The best real catch** (worth a detour if they're interested): FMCG → **Plan a launch promotion**. Model B caught
a real **P0** in Model A's draft: the source says bundles beat discounts by 18%, and the draft turned that into
"discounts drove 18% less trial", which is wrong (it's 15.3%). The output opens with the wrong sentence next to the fix.

## 6. Break it yourself (40 s)

Scroll to **Try to break it**. Click **Try a common mistake** (it loads the classic wrong figure, here "age" as an input). The check fails: "age" is a protected
attribute. When the run reaches **Code checks** it stops, and nothing goes to a person.

> "These checks are code, not a model grading a model."

Click **Reset figures**, then approve the PRD.

## 7. Design before code (20 s)

Architecture: Model B's review raises a **P0**. A soft credit pull needs recorded consent. Approve the design.

> "The cheapest place to catch a mistake is before the code exists."

## 8. Code, review, and the unit-test trap (40 s)

Click **Write code**: the real code, as first written. The bug in it was planted to show the mechanism, and the
page says so. The code and the tests are real.

Code review: three points. Model C decides which to apply, and Model A declines one with a reason. If the live
answer differs from what Model A did, the page says so. Leave it on screen; it is honest.

Unit tests: Model A's own five tests **pass**, on code that still has a bug.

> "An author tests what they thought of."

## 9. Independent tests, really run (45 s)

Everything in this stage is a real recording. Model B wrote the test cases and script from the PRD and the contract,
**without seeing the code**, and they really ran against Model A's code: in all five builds every test passed first
time, because design and code review had already caught the problems (point at the P0s in Architecture and Code
review). Click **Write code** to show the real code.

Scroll to **Run the tests yourself** and press **Run** and **Measure the tests**. Mutation testing breaks the code
in every small way and reruns the tests: in the FMCG build they catch only **4 of 11**.

> "Passing tests prove little on their own. We measure how strong the tests are, and show you when they're weak."

## 10. Ship it safely (25 s)

Staging, smoke tests, Model C's live **go**, then a person approves production. The rollout is gradual and
there is a rollback plan.

## 11. Close (20 s)

The **What happened** recap tells every stage in one sentence. The output opens with **One AI alone would have
handed you** next to **What you get instead**.

> "Eight stages. Each one caught something the others didn't. A live run on your own problem costs about 30
> cents in model calls and about 25 minutes, most of it staging and rollout."

## For a serious visitor: their own brief, live

Scroll to **Run the real panel on your own request**. Give them the passcode and let them type a real-world brief
(made-up names, no personal data) and any facts. Model C routes it live; then the two models draft, review and merge
while they watch, about $0.10 and 3 to 6 minutes. Our test run, a supplier shortfall letter, had Model B catch two P0s
in Model A's draft: it claimed a penalty week had passed when only six days had.

## Hard questions, straight answers

- **"Is this real?"** Partly, and the page says which parts. The proof run, the Jev decisions, the checks and
  the tests are real; the diagram marks steps as **real code**, **live**, **recorded** or **replay**. Drafts,
  reviews and merges replay real recorded runs, so the booth costs nothing. The architecture, code review and
  deployment stages are still prepared, and the bug the tests catch was planted to show the mechanism.
- **"You wrote both the mistake and the catch."** Not any more. Every workflow's drafts, reviews and merge are a
  recording of a real run, labelled "Recorded live call" with its real time, tokens and cost. What they caught is
  what the models caught.
- **"Model C's triage just reads the labels."** Here, yes, and the caption says a plain rule would decide the
  same. Model C earns its keep on calls with no labels, like routing.
- **"How often does cross-review actually catch things?"** Eleven real runs so far: one caught a P0 (the 17-day
  deadline in the proof box) and ten caught 34 P1/P2 gaps. A measured comparison against a single model is built
  and pending. Don't claim a rate we haven't measured.
- **"What stops the models colluding?"** They are different vendors, they never see each other's drafts, the
  checks are code, the tests are written from the PRD and not the code, and a person approves at four gates.
- **"Cost?"** Measured on 50 real calls: the two-model panel costs $0.09–0.22 a run. A whole feature build comes
  to about $0.30 in model calls and about 25 minutes; a document $0.09–0.22 and 1–5 minutes. Each Model C decision
  costs about $0.00002.
- **"Did the real runs catch anything?"** Yes, and honestly. On the current models (Opus 5.5 and Grok 4.7), ten real
  runs raised 13 points, including one real P0 (the FMCG trial figure). Earlier runs on Opus 5 raised 34, all P1 or P2. They were real gaps, like an untested access rule or practice problems that were never
  written, and every merge resolved them, rejecting some with reasons. The dramatic catches in earlier replays were
  planted, and are gone.
