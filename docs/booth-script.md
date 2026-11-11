# Booth script: for a visitor who knows AI coding and testing

About 6 minutes. Site: https://kodiflex-foundry-production.up.railway.app

They have seen agents write code. What they have not seen is a reason to trust the code. Every beat below
answers one sceptical question with something on the screen. Let them drive whenever they want to.

## Before they arrive

- Open the site on a laptop at least 1400 px wide. Choose **Technical** (top right).
- Pick **Financial services**, then **Ship a loan pre-qualification check**. Set the speed to **60×**. Leave it on
  step 1 ("1 of 35 · The brief").
- What you see, top to bottom: the **Proof** box (open), the domain and workflow pickers, three model cards
  (Model A Builder, Model B Checker, Model C Decider), a rail of 8 stages (PRD to Deployment), five tiles (Step,
  Model time, Would cost, Checks, Spent for real), the controls, and the pipeline diagram.
- Below the diagram, secondary sections sit folded to one line: **What happened**, **Measured: can Model C make it
  cheaper?**, **Try to break it**, **Run the tests yourself**, **Run log**. Each opens by itself when the run
  reaches it and folds again when the run moves on. Click any of them to open it yourself.
- Shortcuts: **Space** play or pause, **A** approve, **N** next step, **R** restart, **T** plain or technical,
  **1–8** jump to a stage.

## 1. The hook (20 s)

> "Everyone shows an agent writing code. We show why you can trust what it wrote."

Point at the **Proof** box: a real, metered run of the requirements panel. Two models, $1.52, about 21 minutes,
and Model B caught Model A calling a deadline 17 days away "within 14 days". Offer **Download the run record**.
The box folds away by itself when you press Play.

## 2. Roles, not vendors (15 s)

Point at the three cards: Model A builds, Model B checks and comes from a different vendor, Model C decides.

> "Swap any model in. What matters is that the checker is independent of the builder, and the cheap decisions
> don't go to an expensive model."

## 3. A live decision (20 s)

Press **Space**. **Route** lights up with **Live decision**, about 100 ms and a fraction of a cent. Click the Route
node: risk **high · 0.86**, touches financial data **yes · 0.97**, one model alone **no · 0.84**, so it goes to the
full panel.

> "That call just happened. A decision model, not an LLM: typed answers with calibrated confidence."

Click **Now try the router on a low-risk request**. The same live model gets a footer typo fix and says
**low → one model and a person**.

> "It tells risky work from trivial work, and only the risky work pays for two models."

## 4. Their turn (15 s)

Model A asks four questions (debt-to-income limit, gross or net income, other factors, what a declined applicant
sees). It stops at **Your answers** with suggested answers: 43% of gross income, credit score of at least 640,
nothing else, and a plain-words reason that says it is not a final decision. Have them press **Accept these
answers** (or **A**).

## 5. The catch (40 s)

Draft A and Draft B are written apart; the diagram says **cannot see each other**. Each step's panel carries a
**Recorded live call** badge with its real time, tokens and cost.

- Click **A reviews B**: Model A found 2 points in Model B's draft. **D-B1 · P1**: REQ-1 tells the applicant the
  outcome and the reason only when both rules pass, which contradicts the brief. **D-B2 · P2**: no test for both
  rules failing.
- Click **B reviews A**: **No defects found**.
- **Triage** (Model C) marks which findings the merge must fix, then **Merge** (Model A) resolves them.

> "Nothing here is planted. These are real gaps one model found in the other's work, and the merge fixed them."

Click **Final check** (new): Model B reviews the merged result once more, under a strict rule (any wrong figure,
date, threshold or rule is serious). Here it found nothing more and says why: the boundary maths at exactly 43% and
640 is right.

> "We measured this step. On 8 full requirements documents that a strict all-Claude panel had already passed, it
> raised 16 serious faults. Checked one by one, 7 really were serious, like a rule that is mandatory in one
> requirement and optional in another, and 6 more were real but minor. When there's nothing to find, it says so."

Where it did find something: **Logistics → Ship delay notifications**. The final check flagged that two tests
would pass on a notice showing a time without the date the requirement demands, and Model A fixed it (step
**Fix**).

**The best real catch**, if they want a detour: **FMCG → Plan a launch promotion**, **B reviews A**: a real
**P0**. The source says bundles beat discounts by 18%; Model A's draft turned that into "discounts drove 18% less
trial", which is wrong (it is about 15.3%). The output opens with the wrong sentence next to the fix.

## 6. Break it yourself (40 s)

When the run reaches **Code checks**, **Try to break it** opens below the diagram (or click the button in the step
panel). Click **Try a common mistake**: it loads "Debt-to-income, credit score, and age (over 60: 35% limit)". The
check fails because age is a protected attribute, and the run stops at Code checks: nothing goes to a person.

> "These checks are code, not a model grading a model."

Click **Reset figures**, then approve the PRD (**A**).

## 7. Design before code (20 s)

Press **2** for Architecture. Model A designs; **B reviews it** raises **AR-1 · P0**: on a pass the contract
returns no reason, but the requirements promise every applicant a plain-words reason. Model A revises, and the
conflict goes to the credit-risk lead. Approve the design.

> "The cheapest place to catch a mistake is before the code exists."

## 8. Code and code review (40 s)

**Write code**: the real JavaScript Model A wrote, recorded. **Code review**: Model B raises three points.
**CR-1 · P0**: a decline never says "this is not a final decision". **CR-2 · P1**: a pass returns no reason.
**CR-3 · P1**: the decline overstates the debt-to-income percentage.

**Decide** (Model C, live): apply CR-1 (yes · 0.73) and CR-3 (yes · 0.91), not CR-2 (no · 0.85). **Apply review**:
Model A applies CR-1 and declines CR-2 with its reason (the contract requires an empty reason on a pass), and flags
the conflict for a person. If the live answer ever differs from what Model A did, the page says so.

**Unit tests**: Model A's own 6 tests pass.

> "An author tests what they thought of. The next stage tests what was asked for."

## 9. Independent tests, really run (45 s)

**Test cases** and **Test script**: Model B writes them from the PRD and the contract, **without seeing the code**.
**Run tests**: they really ran against Model A's code, and every test passed on the first run, because design and
code review had already caught the problems. In all five builds that was the case.

**Run the tests yourself** opens. Press **Run**: the model-written tests run on the model-written code, here in the
browser. Then **Measure the tests: break the code on purpose**. Mutation testing makes small breaks and reruns the
tests: for the loan check they catch **16 of 28**. In the FMCG build only **4 of 11**.

> "Passing tests prove little on their own. We measure how strong they are, and show you when they're weak."

## 10. Ship it safely (25 s)

Press **5**. Release gate, staging, smoke tests (4 of 4), Model C's live **go** (yes · 0.97, rollback plan yes ·
0.92, risk to users no · 0.94), then a person approves production. Gradual rollout with a rollback plan. Be clear
that this deployment stage is prepared, not a real deploy; the page labels it.

## 11. Close (20 s)

**What happened** opens at the end: every stage in one sentence. The output opens with **One AI alone would have
handed you** next to **What you get instead**.

> "Eight stages. Each one caught something the others didn't. A real feature build costs about 30 to 45 cents in
> model calls and 27 to 39 minutes, most of it waiting on Model B."

## For a serious visitor: their own brief, live

Open the fold **Run the real panel on your own request**. Give them the passcode and let them type a real-world
brief (made-up names, no personal data) and any facts. Model C routes it live. A low-risk brief goes to one model;
anything else gets both drafts, crossed reviews, the merge and the final check, live, in about 4 to 8 minutes
for about $0.15. The day's spend is capped at $5. Our test run, a supplier shortfall letter, had Model B catch two
P0s in Model A's draft: it claimed a penalty week had passed when only six days had.

## Hard questions, straight answers

- **"Is this real?"** Yes, except deployment. Drafts, reviews, merges, final checks, architecture, code, code review
  and tests are recordings of real model runs, each labelled with its real time, tokens and cost; replaying them
  costs nothing. Model C's decisions run live. The code checks and the tests are real code running in your
  browser. The deployment stage is prepared and labelled.
- **"You wrote both the mistake and the catch."** No. Nothing is planted. What they caught is what the models
  caught, including the reviews that found nothing.
- **"Model C's triage just reads the labels."** For triage, a plain rule would decide the same, and the caption
  says so. Model C earns its keep on calls with no labels, like routing and which review points to apply.
- **"How often does review actually catch things?"** Measured (about $42 of real calls; write-up in
  `docs/eval-results.md`):
  - On 36 planted defects, Model A caught 35 and Model B 36.
  - On 8 real briefs, every review setup fixed the gate failures a single draft had.
  - A final check by the other vendor raised 16 serious faults that a strict all-Claude panel had passed. Checked
    one by one, 7 were serious, 6 real but minor, and 3 wrong.
  - Claude reviewing its own work found most of its mistakes but rated 4 of 5 serious ones as minor. That is why
    the final check comes from a different vendor.
- **"What stops the models colluding?"** They are different vendors, they never see each other's drafts, the
  checks are code, the tests are written from the PRD and not the code, and a person approves at four gates.
- **"Cost?"** A document costs $0.09–0.22 and takes 1–5 minutes. A whole feature build costs $0.29–0.45 and takes
  27–39 minutes, almost all of it waiting on Model B. Each Model C decision costs about $0.00002.
- **"What isn't done?"** Integration with your repositories and CI, real deployments, and a faster Model B. Some
  model-written tests are weak (the mutation scores show where).
