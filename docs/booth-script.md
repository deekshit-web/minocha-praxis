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

Drafts are written apart ("cannot see each other"). **B reviews A** turns red: *caught a serious defect*. Click
it: Draft A used **age** to tighten the lending limit. That is unlawful.

> "A single agent would have shipped that. Model B caught it, Model C triaged it in a tenth of a second,
> and the merge had to fix it."

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

## 9. Independent tests catch it (45 s)

Model B wrote the test cases from the PRD without seeing the code. **Run tests: 1 failing**. "Exactly 43% is
pre-qualified": the code added 0.28 + 0.15 and got 0.43000000000000005. Claude fixes it; all pass.

Click **Fix** to see the real diff. Then scroll to **Run the tests yourself** and press both buttons: real
tests, real code, about a millisecond.

Then press **Measure the tests: break the code on purpose**. Mutation testing breaks the fixed code in every
small way (`<` to `<=`, `&&` to `||`, each number nudged by one) and reruns every test: "caught 7 of 9". Point
at the survivors it lists.

> "We show you where the tests are weak, too."

## 10. Ship it safely (25 s)

Staging, smoke tests, Model C's live **go**, then a person approves production. The rollout is gradual and
there is a rollback plan.

## 11. Close (20 s)

The **What happened** recap tells every stage in one sentence. The output opens with **One AI alone would have
handed you** next to **What you get instead**.

> "Eight stages. Each one caught something the others didn't. A live run on your own problem costs about $3
> and takes about an hour."

## Hard questions, straight answers

- **"Is this real?"** Partly, and the page says which parts. The proof run, the Jev decisions, the checks and
  the tests are real; the diagram marks steps as **real code**, **live** or **replay**. Drafts and reviews are
  replayed so the booth costs nothing, and the bugs in them were planted. The proof box links the full
  transcript of the real run.
- **"You wrote both the mistake and the catch."** In the replay, yes. Say so. The real evidence is the proof
  run, where a model caught a mistake nobody planted, and the full transcript is downloadable. Recording real
  runs for every workflow is the next step.
- **"Model C's triage just reads the labels."** Here, yes, and the caption says a plain rule would decide the
  same. Model C earns its keep on calls with no labels, like routing.
- **"How often does cross-review actually catch things?"** The proof is one run. A measured evaluation across
  many cases, against a single-model baseline, is built and pending. Don't claim a rate we haven't measured.
- **"What stops the models colluding?"** They are different vendors, they never see each other's drafts, the
  checks are code, the tests are written from the PRD and not the code, and a person approves at four gates.
- **"Cost?"** About $3 and an hour for a feature, $1.50–2 for a document. Each Model C decision costs about
  $0.00002.
