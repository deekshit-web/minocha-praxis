# How it is built, and why

A reference for the team. Read this before a demo, so that when someone asks "how does it work?" or "why did you
choose that?", you have the answer and know where it stops being true. Every claim here points at a file or a
measured number. Where something is not done or not proven, it says so.

## In one paragraph

It is a delivery pipeline for software features in which several AI models do the work and **plain code decides
whether the work may move on**. Two different vendors' models write and review each other's work. Code checks, not
a model, verify the result. A person approves at defined gates, and an approval stops counting if the approved
document changes. The whole thing is TypeScript on Node 22, with no agent framework.

## The three programs

| Name | What it is | Command | Port |
| --- | --- | --- | --- |
| **Workbench** (`rcm`) | The product that gets changed: a small, synthetic medical-billing denial workbench. | `npm run rcm` | 4173 |
| **Factory** | Walks one feature ("Feature B", CO-50 appeal readiness) from intake to a recorded release, with approval gates. | `npm run factory` | 4317 |
| **Studio** (Kodiflex Foundry) | The demo site: 10 workflows across 5 domains, replayed from real recorded runs. This is what visitors see. | `npm run studio` | 4320 |

The studio is deployed on Railway at https://kodiflex-foundry-production.up.railway.app. The workbench and the
factory run only on your machine.

## The packages

One npm workspace, eight packages under `packages/`. Each has a narrow job, and a test enforces that no package
reaches into another by a relative path (`harness/src/boundaries.test.ts`).

| Package | Job |
| --- | --- |
| `orchestrator` | The core. The state machine, the gates, model clients, schemas, cost accounting. Nothing else is more important. |
| `harness` | Runs the live PRD panel, the evaluations, and the "walk" that records a run. |
| `implementer` | The red-then-green unit loop. Seeds a sandbox copy of the code, bundles the test, runs it. |
| `knowledge` | Retrieval over a small synthetic "pack" of policy files. Gives the PRD its grounded citations. |
| `domain` | The synthetic Northwind billing logic (CARC codes, filing deadlines, appeal readiness). |
| `rcm` | The denial workbench web app and its request guard. |
| `factory` | The web UI for the gated walk. |
| `studio` | The demo site, the recorded builds, the live runs, the sandbox, the diagram generator. |

About 13,000 lines of TypeScript, tests included. 192 tests run with `npm run harness`.

## The three model roles

The page names models by role, not vendor.

| Role | Does | Today |
| --- | --- | --- |
| **Model A, the builder** | Writes the PRD, the design, the code and the fixes. | Claude Opus 5.5 (`orchestrator/src/claude.ts`) |
| **Model B, the checker** | Reviews, and writes the tests. From a different vendor on purpose. | Grok 4.7 (`orchestrator/src/grok.ts`) |
| **Model C, the decider** | Typed yes/no and choice answers with a confidence score: which risk level, which review points to apply, go or no-go. Not an LLM. | Jev (`studio/src/jev.ts`) |

A person makes every approval. Model C only recommends.

## How a run flows

1. **Intake.** A brief comes in. A scan refuses a brief that holds an SSN, email, phone, MRN or labelled birth date.
2. **PRD panel.** Two analysts write the requirements **without seeing each other's draft**. Each then reviews the
   other. A synthesizer merges the two. Rules in `orchestrator/src/panel.ts` refuse the panel if a seat is missing,
   an analyst saw a proposal, a P0 defect is unresolved, or a quality attribute has no note.
3. **Final check.** Model B reads the merged document once more under a strict rule. A different vendor from the
   builder is the point (see "Why two vendors").
4. **Approval gate.** A person approves. The approval is bound to the **hash** of the document, so changing the
   document voids it.
5. **Design.** Model A designs, Model B reviews, Model A revises. The design names the **file fence**: the only files
   that may change. A diagram shows the changing area.
6. **Code.** Model A writes the module to a contract (function names and data shapes). Model B reviews. Model A
   applies or declines each point, with a reason.
7. **Tests.** Model A writes unit tests for its own code. Model B writes acceptance tests **from the PRD, without
   seeing the code**, asked for each requirement and then the edges where code usually goes wrong (limits, zero and
   one, first and last, month ends). They run for real, and a failure in either suite gives Model A up to two fix rounds. In a fix
   round Model A may rewrite its own unit tests if it judges one wrong (the record says so), but never the acceptance
   tests.
8. **Release.** A release gate, staging, smoke tests, Model C's go or no-go, a person approves production.
   **Deployment is prepared and labelled as such. It is not a real deploy.**

In the Factory, steps 1 to 4 and the red-green loop follow the state machine in `orchestrator/src/states.ts`:
14 states on the main line, plus `changes_requested`, `blocked` and `abandoned`, and a table of the moves that are
allowed. Any move not in the table is refused.

## What is enforced by code

These run on every walk and do not trust the recorded content. They are the answer to "why should I trust it?".

| Check | Where | What it refuses |
| --- | --- | --- |
| Hash-bound approval | `orchestrator/src/run.ts`, `hash.ts` | An approval after the approved document changed. |
| State machine | `orchestrator/src/states.ts` | Any transition not in the table. |
| Panel review | `orchestrator/src/panel.ts` | Missing seats, analysts that saw a proposal, unresolved P0s. |
| Grounded citations | `harness/src/panels.ts`, `knowledge/src/retrieve.ts` | A citation to a policy file that retrieval did not find relevant. |
| File fence | `orchestrator/src/fence.ts` | Writes outside the approved paths, and any fence that admits the factory, the gates or secrets. |
| Assertion guard | `implementer/src/tree.ts` | A test change that deletes a required assertion. |
| Execution gate | `orchestrator/src/method.ts` | A review that calls a failing test accurate. |
| Mutation oracle | `orchestrator/src/method.ts` | A test that still passes with the known bug in. |
| Stall detection | `orchestrator/src/stall.ts` | The same failure again, or a third failing attempt. |
| Intake scan | `orchestrator/src/phi.ts` | A brief with personal data. This is a regex demo. |
| Record gate | `orchestrator/src/record.ts`, `harness/src/walk.ts` | Stale approvals, a red unit run, a red P0 case, PHI or secrets in the output. |
| Request guard | `rcm/src/workbench.ts` | A `Host` that is not loopback, a cross-site POST. |

## What is real and what is replayed

This is the question that decides whether the demo is believed. Say it before you are asked.

- **Real, live, every time:** the gates and checks above; Model C's decisions (when its key is set); the code checks;
  the model-written tests, which re-run in the visitor's browser on the model-written code; mutation testing.
- **Real, but recorded:** the drafts, reviews, merges, design, code, code review and test writing for the ten
  workflows. They are recordings of real runs of Claude and Grok. Each step shows its real time, tokens and cost.
  Replaying them costs nothing. Nothing in them is planted.
- **Prepared and labelled:** deployment to staging and production.
- **Live on a visitor's brief:** with a passcode, the PRD panel runs on a real request ($0.07 to $0.15, 4 to 8
  minutes). A full end-to-end build also exists, but is not on the public site yet (see below).

## The live end-to-end build

Built in three phases. Committed on `main`, **not pushed or deployed** at the time of writing. It is **off by default**.

1. **The pipeline.** A request goes through the PRD panel, then a contract step (Model A drafts the function
   names and data shapes, Model B checks that every requirement can be tested through them), then every build stage.
   It reports each call as it lands. It has a cost limit (default $0.75) and a time limit, and stops with the calls
   so far billed and shown.
2. **An isolated sandbox.** Model-written code never runs in the server process. See "The sandbox".
3. **A generated diagram.** Model A draws the approved design as a data-flow diagram. A check refuses a file, a
   finding or an edge the design does not support. It allows one correction, then drops a drawing that still fails.
   A failed drawing never fails the build.

Twelve real runs so far, all on made-up briefs and all on a local machine: two tried by hand, then a ten-build dry
run on 12 November. The write-up is `docs/live-build-dry-run.md`, and the records are in `evals/live-build/`.

Recorded costs undercount Model B: they leave out Grok's hidden reasoning, which was 87% of one week's xAI bill. A
build probably cost about $1.50, not $0.35; see the correction at the top of `docs/live-build-dry-run.md`.

| Runs | Recorded cost per build (Model B undercounted) | Time | Result |
| --- | --- | --- | --- |
| The first two, by hand | $0.32 and $0.39 | 16 to 17 min | All tests passed first time. |
| The dry run: 10 briefs across five domains, five builds at once | $0.25 to $0.45 (mean $0.35) | 8 to 33 min | All 10 finished and all passed their acceptance tests first time (3 of Model A's unit tests failed in two builds, uncounted at the time; both causes are now fixed). The tests caught 67% of 208 mutants, 79% leaving out the 33 that can never change a result; 15 survivors are gaps on ordinary inputs. 7 diagrams passed the check first time and 3 passed after the one correction. |
| A second dry run: 10 new briefs, 4 built to make the first code wrong | $0.26 to $0.53 (mean $0.37) | 11 to 36 min | All 10 passed first time. The four trap builds agree with a reference written from their briefs on 14,671 inputs. Model B's acceptance tests caught 75% of 229 mutants on their own, against 63% before the prompt change; both suites together caught 88% leaving out the 28 that can never change a result, with 2 survivors gaps on ordinary inputs. |

All twenty-two passed first time, including four built to fail, so **the red-run and fix-round path has still not been exercised live**. That does not
mean nothing went wrong upstream: reviewers raised a P0 in 5 of the 10 dry-run builds before any code ran. Read by hand,
3 of the 9 P0s were serious (for example a design that read `exam[0]` of an empty list), 5 were real but rated too high,
and 1 was a false alarm: a code review claimed a `BigInt` added to a string throws, which is wrong, and Model A correctly
declined it. The brief with a wrong example was not followed: the pipeline said the example was wrong and built to the
rules. This is one reader's check; independent rating is set up in `evals/live-build/judging/`.

What the second run showed. Model B's design review raised a real issue, not an arithmetic one: the brief's 50.00
monthly cap did not say whether it applies per loan or per account, so a statement screen could show several loans
each at 50.00 and break the rule. Model A revised the design to leave the screen out of the change until the
requester confirms. The generated diagram shows exactly that: the screen as "Deferred, not changed now" and
unchanged. One gap: the module Model A wrote still includes a statement-level helper that the tests exercise, so the
code is wider than the design's deferral. Nothing checks code scope against the design yet. That would be a good
next check.

**The replay.** A finished live build opens in the same stage-by-stage view as the recorded workflows, with its real
times and costs, its diagram, and a downloadable JSON record of every stage. The replay contains only the steps that
ran: no clarifying questions, no triage, no PRD checks, no approval gates and no deployment, and its text says so.
The code is never run in a visitor's browser, because it comes from a stranger's brief and a shared link would run it
in someone else's browser. The replay is kept in server memory (the last 20 runs), so the record is what to keep.

Not done: approvals in a live build are not real pauses for a person, and the test lab and mutation testing are not
yet offered for a live build (they would have to run in the isolated sandbox, not the browser).

## The sandbox

Model-written code has to run somewhere to be tested, and that is the riskiest thing the server does.

The old sandbox was a worker thread with a regex scan. That was **not safe**: the scan blanks out string literals
before it looks for names, so `[].filter["con"+"structor"]` gets past it, and a worker thread shares the server's
environment, API keys included. We reproduced a leak of an environment secret and `/etc/passwd`.

The current sandbox (`studio/src/isolate.ts`) runs the code in a child process with:

- an empty environment, so there are no keys to read;
- Node's permission model with no grants: no file reads or writes, no child processes, no workers, no native addons;
- its own network namespace (`unshare -rn`), because the permission model alone does not stop network calls;
- a time limit, a memory limit and an output cap, and a random per-run marker so the code cannot print a fake result.

17 hostile-code tests attack each protection. It is defense in depth, not a proof. A hosted server enables the full
build only if the host allows a network namespace. **Railway does not, reliably.** On 12 November 2026 we deployed the
same `unshare -rn` check to a throwaway Railway project five times, from the production base image. As the `node` user,
which the Dockerfile uses, it was denied every time. As root, it worked once, on an older host (kernel 6.12), where
network calls from inside were blocked, and was denied on a newer one (kernel 6.18). The kernel allows user namespaces,
but a seccomp filter on the newer hosts blocks `unshare`, and Railway chooses the host. So the hosted site does not run
model-written code: `networkIsolated()` is false there, and the server refuses to run the code rather than run it
without the namespace. Running live builds in public needs a host we control, such as a small VM.

## Why these choices

| Choice | Why | The cost |
| --- | --- | --- |
| **TypeScript on Node 22** | One language and one type system for the server, the tests, the demo page and the shared check code that runs in both Node and the browser. | The AI-evaluation tooling ecosystem is bigger in Python. |
| **Zod 4 for model output** | Every model call has a schema. The model must answer in JSON that matches it, and the answer is parsed before use. This is what Pydantic would do in Python. | Nothing notable. |
| **A hand-written state machine** | The guarantees we sell (hash-bound approval, a file fence, an illegal move refused) must be small functions we control and can show. A framework would sit between us and them. | We wrote the orchestration ourselves: no integrations, no community. |
| **No LangChain, no LangGraph** | See below. | See below. |
| **The Anthropic SDK and a small Grok client** | One `ModelProvider` interface for every call, so a model can be swapped and every call is metered the same way. | We maintain two clients. |
| **esbuild and `node:test`** | Fast, almost no dependencies. Tests are bundled and run under Node's own runner. | `esbuild` strips types without checking them, so `npm run typecheck` is a separate step. |
| **One HTML page, plain JavaScript** | The demo page is a single file with no build step for the front end and no framework. It loads and works anywhere. | The file is large (about 2,500 lines). |
| **Replay of real recordings** | A demo that costs nothing, never fails on a bad network and still shows real model behaviour, time and cost. | It is a replay, and we say so on the page. |
| **Docker on Railway, deployed with `railway up`** | Simple and cheap. The image holds only what the server reads at runtime, and a test checks that. | Railway does not deploy on a GitHub push for this project. |

### Why not LangChain, LangGraph or Pydantic

- **LangChain** wraps model calls and chains. We call the model through our own interface so every call is metered
  and every answer is schema-checked. A wrapper would add a layer without adding a guarantee.
- **LangGraph** models a workflow as a graph with state. Ours is a table of allowed moves plus tested gate
  functions. Each gate is readable in a minute, which matters when the pitch is "you can trust the gates".
- **Pydantic** is Python. Zod is its TypeScript equivalent, and it shares the language of the rest of the system.

**The honest version.** We chose a design that is appropriate for this purpose, with known trade-offs. We did not
build the same pipeline in LangGraph and compare, so "the most appropriate" is a judgement, not a measurement.
LangGraph is better at one thing we lack: **durable checkpoints and "interrupt for a human"**. Our planned real
approvals (pausing a long run at a gate and surviving a restart) need that, and today job state lives in memory.
That is where we would use LangGraph or write the equivalent.

### Why two vendors

When Claude reviews its own work it finds most of the problems but **rates them lower than the other model does**.
In our test, it found 5 of 6 problems but rated 4 of them lower, and telling it "a wrong figure is a P0" did not fix
that. A different vendor's final review raised 16 serious findings on 8 documents that a strict all-Claude panel had
already passed. So the last review comes from the other vendor.

## The evidence

Full write-up: `docs/eval-results.md`. About $42 of real, metered calls.

- **Planted defects:** 36 PRDs, each with one defect. Claude caught 35 and Grok 36. Catching a planted defect does
  not separate reviewers.
- **Final review:** 16 serious findings on 8 documents. Sorted one by one, **7 were serious, 6 real but minor, 3
  wrong.** The kind that mattered were inconsistencies: a rule mandatory in one requirement and optional in another,
  a P0 criterion that cannot decide pass or fail.
- **Cheaper routing:** letting Model C skip reviews gave **23% lower cost and 6% more time**, but the blind judges
  preferred the full panel in 10 of 12 verdicts. Only skipping the slow review held up.
- **Other merge models**, on all 10 workflows: Opus 5.5 matched Opus 5 (23% less cost, 27% less time on the four
  workflows where it was compared). Sonnet 5.5 was 56% cheaper but dropped findings. Haiku 5.5 was 97% cheaper but
  dropped more. A faster Grok as Model B was about 23 times faster but invented 51 review findings and lost.
- **Cost of a build:** $0.29 to $0.49 recorded for the five demo builds; $0.32 and $0.39 for the two live builds.

**Limits an expert will find.** Eight briefs is a small sample. Claude Code sorted the 16 findings, not a person.
There is no false-alarm rate, because our clean control documents turned out to contain a real flaw. There is no
score yet for the consistency problems the final review finds. Twenty-two live builds have been measured. None needed a fix round, and all were small single-function features in made-up domains.

## Questions you will get

**Is this real?** Yes, apart from deployment. Drafts, reviews, code and tests are recordings of real runs, labelled
with their real time and cost. Gates, checks and tests are live code.

**Are you using LangChain, LangGraph or Pydantic?** No. TypeScript with Zod and a small state machine of our own.
See "Why not LangChain, LangGraph or Pydantic", and give the honest version if pressed.

**Why two vendors?** A model rates its own mistakes as less serious than another vendor's model does. We measured it.

**What stops the models colluding?** They are different vendors. The drafts are written apart. The checks are code.
The tests come from the PRD, not from the code. A person approves at the gates.

**You wrote both the mistake and the catch.** No. Nothing is planted in the walk-through. The planted-defect test is
separate, and we say so.

**What if a model writes malicious code?** It runs in a child process with no keys, no files, no processes and no
network, and with time, memory and output limits. This is defense in depth and we do not claim it is unbreakable.

**Can I run it on my feature?** The PRD panel runs live on your brief with a passcode. A full live build exists
but is switched off on the public site until the sandbox is confirmed on the host.

**How much does it cost?** A document $0.09 to $0.22. A feature build recorded $0.25 to $0.45 on live models over twelve runs, but those figures left out Grok's hidden reasoning; the true cost was probably about $1.50 a build (see `docs/live-build-dry-run.md`). It takes 8 to 33 minutes.
Each Model C decision costs about $0.00002.

**How do you know the tests are good?** We run mutation testing: small deliberate breaks in the code, then the
tests. For the loan check they catch 16 of 28. For one FMCG build only 4 of 11. We show the weak scores.

**Does a person really approve?** Yes, at the gates, and the approval is tied to the document's hash. In a live
build the approvals are not yet real pauses, and the page labels them.

**Why not just ask one strong model to review itself?** We measured it. A same-model review rates its own findings
too low, and a different-vendor final review found real faults that it passed.

**Is the PHI check real protection?** No. It is a regex demo that finds an SSN, email, phone, MRN or labelled birth
date. It does not find names, addresses or unlabelled dates. Use synthetic data only.

**What is not done?** A real repository and CI path, real deployments, a faster Model B, a score for consistency
problems, a false-alarm rate, real approvals in a live build, and a live build that fails its tests (to exercise the fix rounds).

## Where things are

| To look at | Open |
| --- | --- |
| The state machine and gates | `packages/orchestrator/src/` |
| The recorded builds and the live build | `packages/studio/src/build.ts`, `live.ts` |
| The sandbox | `packages/studio/src/isolate.ts` and `isolate.test.ts` |
| The diagram generator | `packages/studio/src/diagramGen.ts` |
| The demo page | `packages/studio/public/index.html` |
| The evaluation write-up | `docs/eval-results.md` |
| The live build dry run, with its data | `docs/live-build-dry-run.md`, `evals/live-build/` |
| Rating the reviewers' findings (false alarms) | `evals/live-build/judging/`, `packages/studio/src/judging.ts` |
| The booth walk-through | `docs/booth-script.md` |
| The README's "what is recorded and what is enforced" | `README.md` |

Commands: `npm run harness` (tests), `npm run typecheck`, `npm run studio`, `npm run factory`, `npm run rcm`,
`npm run record-builds`, `npm run compare-levers`, `npm run eval-prd`.
