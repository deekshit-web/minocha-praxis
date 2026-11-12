# Booth script: for a visitor who knows AI coding and testing

About 6 minutes. Site: https://kodiflex-foundry-production.up.railway.app

These people have watched agents write code. What they want to know is why they should trust it. Each part below
takes one doubt they're likely to have and answers it with something on the screen. Let them take over the mouse
whenever they like. Say it your own way. The quoted lines are only a guide to the tone: short, plain, no pitch.

## Before they arrive

- Open the site on a laptop at least 1400 px wide. Choose **Technical** (top right).
- Pick **Financial services**, then **Ship a loan pre-qualification check**. Set the speed to **60×**. Leave it on
  step 1 ("1 of 35 · The brief").
- What you'll see, top to bottom: the **Proof** box (folded to one line), the domain and workflow pickers, three model cards
  (Model A Builder, Model B Checker, Model C Decider), a row of 8 stages (PRD to Deployment), five tiles (Step,
  Model time, Would cost, Checks, Spent for real), the controls, and the pipeline diagram.
- Below the diagram, the other sections sit folded to one line: **What happened**, **Measured: can Model C make it
  cheaper?**, **Try to break it**, **Run the tests yourself**, **Run log**. Each one opens by itself when the run
  gets to it and folds again when the run moves on. You can click any of them open.
- Shortcuts: **Space** play or pause, **A** approve, **N** next step, **R** restart, **T** plain or technical,
  **1–8** jump to a stage.

## 1. The opening (30 s)

> "Most demos show an agent writing code. We wanted to know when you can believe a review. One thing we found: when
> Claude reviews its own work, it spots most of the problems but marks them as less serious than they are. So the
> last review in this pipeline comes from a different vendor. I'll show you where that matters."

Click the **Proof** box open. It's a run with the meter on: two models, $1.52, about 21 minutes. The mistake it
caught there is small (a deadline 17 days away called "within 14 days"), so don't lean on it. Its use is that the
whole transcript is downloadable: **Download the run record**. Fold it again when you're done with it.

## 2. Roles, not vendors (15 s)

Point at the three cards. Model A builds. Model B checks, and it's from a different vendor. Model C makes the small
decisions.

> "You can swap any model in. What matters is that the checker isn't the builder, and that the cheap calls don't go
> to an expensive model."

## 3. A live decision (20 s)

Press **Space**. **Route** lights up with **Live decision**: about 100 ms, a fraction of a cent. Click the Route
node. Risk **high · 0.86**, touches financial data **yes · 0.97**, one model alone **no · 0.84**, so it goes to the
full panel.

> "That call just ran live. It isn't an LLM. It gives typed answers with a confidence score."

Click **Now try the router on a low-risk request**. The same live model gets a typo fix in a footer and says
**low → one model and a person**.

> "So it can tell a footer typo from a loan decision, and only the loan decision pays for two models."

## 4. Their turn (15 s)

Model A asks four questions: the debt-to-income limit, gross or net income, anything else that counts, and what a
declined applicant sees. It stops at **Your answers** with suggested answers: 43% of gross income, a credit score
of at least 640, nothing else, and a plain-words reason that says this isn't a final decision. Have them press
**Accept these answers** (or **A**).

## 5. What the review catches (60 s)

Draft A and Draft B are written separately. The diagram says **cannot see each other**. Each step's panel has a
**Recorded live call** badge with its real time, tokens and cost.

- Click **A reviews B**. Model A found two things in Model B's draft. **D-B1 · P1**: REQ-1 only tells the applicant
  the outcome and the reason when both rules pass, which contradicts the brief. **D-B2 · P2**: there's no test for
  both rules failing.
- Click **B reviews A**. **No defects found**.
- **Triage** (Model C) marks which findings the merge has to fix. **Merge** (Model A) resolves them.

> "None of this is planted. These are gaps one model found in the other's draft. And on the other side, it did
> sometimes find nothing, and said so."

Now click **Final check**. Model B reads the merged result again under a strict rule: any wrong figure, date,
threshold or rule counts as serious. Here it finds nothing else, and says why: the boundary at exactly 43% and 640
is right. This is the step to spend time on with an expert, so use the numbers from our own eval. These aren't on
the screen. The write-up is `docs/eval-results.md`.

> "We ran this on 8 full requirements documents that a strict all-Claude panel had already passed. The other
> vendor's final review still raised 16 serious findings. We went through them one by one. Seven were serious.
> Six were real but minor. Three were wrong. So it over-rates things, and the fix step has to be allowed to say no."

If they ask what a serious one looks like, use these, not an arithmetic slip:

- One requirement says a line without an authorization id must be routed. Another makes routing the specialist's
  choice.
- A P0 acceptance criterion expects a count of 1, so a pass can't show which of two claims was counted. The test
  can't decide.
- The rule that bans working a certain line misses two of its states, upheld and overturned.
- A P0 scenario opens a line from a queue the document says the line has already left.

> "None of those is a wrong number. Each one is a document that disagrees with itself, or a test that can't fail,
> and a same-model panel read straight past them."

Be upfront about the limits. Claude Code did the sorting of those 16, not a person, so a person should check it.
It's 8 briefs. And our checklist scorers barely noticed the improvement, because they score whether the brief is
covered and not whether the document is consistent. We haven't built that score yet.

Where the final check found something on screen: **Logistics → Ship delay notifications**. It flagged that two
tests would pass on a notice showing a time with no date, and the requirement demands the date. Model A fixed it at
the **Fix** step.

If they want one more real catch with the output in front of them: **FMCG → Plan a launch promotion**, **B reviews
A**, a **P0**. The source says bundles beat discounts by 18%. Model A's draft turned that into "discounts drove 18%
less trial", which is wrong (about 15.3%). The output opens with the wrong sentence next to the fix. It's simpler
than the cases above, so use it second.

## 6. Break it yourself (40 s)

When the run reaches **Code checks**, **Try to break it** opens below the diagram. You can also click the button in
the step panel. Click **Try a common mistake**. It loads "Debt-to-income, credit score, and age (over 60: 35%
limit)". The check fails because age is a protected attribute, and the run stops at Code checks. Nothing goes on to
a person.

> "Those checks are plain code. There's no model grading another model here."

Click **Reset figures**, then approve the PRD (**A**).

## 7. Design before code (20 s)

Press **2** for Architecture. Model A designs. **B reviews it** raises **AR-1 · P0**: on a pass the contract returns
no reason, but the requirements promise every applicant a reason in plain words. Model A revises, and the conflict
goes to the credit-risk lead. Approve the design.

> "It's much cheaper to find that now than after the code is written."

## 8. Code and code review (40 s)

**Write code** shows the real JavaScript Model A wrote, recorded. **Code review**: Model B raises three points.
**CR-1 · P0**: a decline never says "this is not a final decision". **CR-2 · P1**: a pass returns no reason.
**CR-3 · P1**: the decline overstates the debt-to-income percentage.

**Decide** (Model C, live) says apply CR-1 (yes · 0.73) and CR-3 (yes · 0.91), but not CR-2 (no · 0.85). **Apply
review**: Model A applies CR-1 and turns down CR-2 with its reason (the contract requires an empty reason on a
pass), and flags the conflict for a person. If the live answer ever differs from what Model A did, the page says so.

**Unit tests**: Model A's own 6 tests pass.

> "A developer tests what they thought of. The next stage tests what was actually asked for."

## 9. Independent tests, really run (45 s)

**Test cases** and **Test script**: Model B writes them from the PRD and the contract, **without seeing the code**.
**Run tests**: they really ran against Model A's code, and every one passed the first time, because design review
and code review had already caught the problems. That held for all five builds.

**Run the tests yourself** opens. Press **Run** and the model-written tests run on the model-written code, here in
the browser. Then press **Measure the tests: break the code on purpose**. Mutation testing makes small breaks in the
code and reruns the tests. For the loan check they catch **16 of 28**. In the FMCG build it's only **4 of 11**.

> "A passing test doesn't tell you much by itself. So we measure how strong the tests are, and you can see where
> they're weak."

## 10. Ship it (25 s)

Press **5**. Release gate, staging, smoke tests (4 of 4), then Model C's live **go** (yes · 0.97, rollback plan yes
· 0.92, risk to users no · 0.94), then a person approves production. The rollout is gradual, with a rollback plan.
Say plainly that this deployment stage is prepared, not a real deploy. The page labels it that way.

## 11. Close (20 s)

**What happened** opens at the end, with one sentence per stage. The output opens with **One AI alone would have
handed you** next to **What you get instead**.

> "A real feature build comes to about 30 to 45 cents in model calls and 27 to 39 minutes, and most of that time is
> waiting on Model B."

## For a serious visitor: their own brief, live

Open the fold **Run the real panel on your own request** and give them the passcode. Let them type a real-world
brief (made-up names, no personal data) and any facts. Model C routes it live. A low-risk brief goes to one model.
Anything else gets both drafts, the crossed reviews, the merge and the final check, live, in about 4 to 8 minutes
for around $0.15. The day's spend is capped at $5. In our test run, a supplier shortfall letter, Model B caught two
P0s in Model A's draft: it said a penalty week had passed when only six days had.

## Questions you'll get

- **"Is this real?"** Yes, apart from deployment. The drafts, reviews, merges, final checks, architecture, code,
  code review and tests are recordings of real model runs. Each is labelled with its real time, tokens and cost, and
  replaying them costs nothing. Model C's decisions run live. The code checks and the tests are real code running in
  your browser. The deployment stage is prepared, and it says so.
- **"You wrote both the mistake and the catch."** No. Nothing is planted in the walk-through. What you see is what
  the models caught, including the reviews that found nothing. The planted-defect test is separate, and we say so below.
- **"Model C's triage is just reading the labels."** For triage, a plain rule would decide the same, and the caption
  says that. Model C earns its place on the calls that have no labels, like routing and which review points to apply.
- **"How often does review catch things?"** We measured it. It was about $42 of real calls, and the write-up is in
  `docs/eval-results.md`.
  - 36 PRDs each had one planted defect. Model A caught 35 and Model B caught 36. So catching a planted defect
    isn't what tells reviewers apart.
  - On 8 real briefs, every review setup fixed the gate failures the single draft had. The mixed Claude and Grok
    panel did not beat the all-Claude panel on the judges' scores, and Grok as a judge agreed.
  - The final check by the other vendor raised 16 serious findings that a strict all-Claude panel had passed.
    Sorted one by one: 7 serious, 6 real but minor, 3 wrong.
  - Claude reviewing its own work found 5 of 6 problems that the other model had flagged, but rated 4 of those 5
    lower (a wrong figure as P2, for example). Telling it a wrong figure is a P0 didn't fix that. That's why the final
    check comes from a different vendor.
- **"Who judged the 16?"** Claude Code, reading the PRD text and the knowledge pack, not a person. A person should
  spot-check it. Eight briefs is also a small sample, and differences under about 0.05 on the checklist are noise.
- **"What stops the models going along with each other?"** They're different vendors and never see each other's
  drafts. The checks are code. The tests are written from the PRD and not from the code. A person approves at four
  gates.
- **"What does it cost?"** A document costs $0.09–0.22 and takes 1–5 minutes. A whole feature build costs
  $0.29–0.45 and takes 27–39 minutes, nearly all of it waiting on Model B. Each Model C decision costs about
  $0.00002.
- **"What isn't done?"** Hooking it up to your repositories and CI, real deployments, and a faster Model B. We also
  have no score yet for the consistency problems the final review finds, and no measured false-alarm rate, because
  our clean control documents turned out to have a real flaw in them. Some of the model-written tests are weak, and
  the mutation scores show where.
