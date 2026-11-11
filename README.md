# Northwind gated delivery demo

A worked example of an agent-driven delivery pipeline with human approval gates, built around one small feature in a synthetic medical-billing product.

The feature, "Feature B": on a CO-50 (medical-necessity) denial, the specialist must not mark the appeal packet ready unless a clinical-note reference and a filing deadline are both present.

The demo walks that feature from intake to a recorded release. It goes through clarifying questions, a requirements document (PRD), an architecture review, a red-then-green unit loop, test design and a traceability check. A person approves each gate, and deterministic checks decide whether the run may move on.

## What is recorded and what is enforced

Read this before anything else.

**The factory replays recorded model steps.** It calls no language model. Each stage replays fixed JSON through `FixturePlayer` (`packages/orchestrator/src/provider.ts`). The PRD stage can also run live on Claude through `npm run live-prd` (see below), but the factory itself stays on recordings. In most stages the two "independent" analyst proposals are the same document, and the UI says so. The repair is a fixed patch that removes a bug the demo planted. The clarifying questions only accept the suggested answers, because the recorded PRD was written for them.

**The gates are real code and are tested.** These checks run on every walk and do not trust the recorded content:

| Check | Where | What it refuses |
| --- | --- | --- |
| Hash-bound approval | `orchestrator/src/run.ts` | An approval no longer counts once the approved document changes |
| State machine | `orchestrator/src/states.ts` | Any transition not in the table, including a change request returning to the wrong draft |
| Panel review | `orchestrator/src/panel.ts` | Missing seats, analysts that saw a proposal, unresolved P0 defects, quality attributes with no note |
| Grounded citations | `harness/src/panels.ts`, `knowledge/src/retrieve.ts` | A PRD or architecture citation to a pack file that retrieval did not find relevant to the brief |
| File fence | `orchestrator/src/fence.ts` | Writes outside the approved globs, and any fence that admits the factory, the gates, the tooling or secret files |
| Assertion guard | `implementer/src/tree.ts` | A test-file write that deletes a required assertion id |
| Execution gate | `orchestrator/src/method.ts` | A review that calls a red test accurate |
| Mutation oracle | `orchestrator/src/method.ts` | A test case that still passes with the known bug present |
| Stall detection | `orchestrator/src/stall.ts` | A repeated diff-and-failure fingerprint, or a third failing attempt |
| Intake scan | `orchestrator/src/phi.ts` | A brief containing an SSN, email, phone number, MRN or labelled date of birth |
| Record gate | `orchestrator/src/record.ts`, `harness/src/walk.ts` | Stale approvals, a red unit run, a red P0 case, or PHI or secrets anywhere in the run's stored output |
| Request guard | `rcm/src/workbench.ts` | On both servers, a `Host` that is not loopback, and a POST whose `Origin` is another site |

The unit loop is also real. The implementer seeds a sandbox copy under `runs/implementer/`, bundles the test with esbuild, and runs it under `node:test`. The P0 cases run against a live workbench server.

The PHI and secret scanners are regex demos. They do not detect names, unlabelled dates of birth, addresses or member ids. Use synthetic data only.

## Running it

You need Node 22 and npm. esbuild and TypeScript are dev dependencies; npm installs the right esbuild build for your platform.

```sh
npm install
npm run harness     # bundle and run every *.test.ts under node:test
npm run typecheck   # esbuild strips types without checking them, so this is the only type check
npm run rcm         # denial workbench on http://127.0.0.1:4173
npm run factory     # factory UI on http://127.0.0.1:4317
npm run live-prd    # play the PRD panel on Claude and run the PRD gates on the result
npm run studio      # Kodiflex Foundry, the zero-token workflow studio, on http://127.0.0.1:4320
```

For the full demo, start the workbench first, then the factory. If the workbench runs somewhere else, set `NORTHWIND_WORKBENCH` (for example `http://127.0.0.1:5173`) when starting the factory. In the factory, step through Begin intake → answers → approve PRD → accept suggestion S-1 → approve architecture → apply the repair → approve tests → record. The trace links open the matching workbench pages. Reset clears the factory session, its sandbox and the workbench ready marks.

### The live PRD stage

`npm run live-prd` plays the five PRD seats (two analysts, two critiques, a synthesis) on real models, then runs the PRD gates on what comes back. With `XAI_API_KEY` set, analyst B and its critique of A run on Grok (`grok-4.7`, `orchestrator/src/grok.ts`) and the other three seats on Claude Opus 5 (`orchestrator/src/claude.ts`), so the two drafts come from different models. Without it, every seat runs on Claude. The gates it runs:

- the panel rules (`orchestrator/src/panel.ts`)
- the PRD checks and grounded citations
- a PHI scan of every seat's output

Each seat answers in a fixed JSON shape (`orchestrator/src/schemas.ts`), and the shared context sits in one cached block. Refusals fall back to another model on the server, and the run records which model answered each seat.

- It needs Claude API credentials: `ANTHROPIC_API_KEY`, or `ant auth login`. Without them it stops before sending anything. Grok needs `XAI_API_KEY`.
- Each run makes five paid calls. The command prints each call's model, time, tokens, cost and quality. xAI calls use the cost xAI reports; Claude calls are priced from list prices, and a model without a known price shows as unknown.
- A failed run saves its finished answers. `npm run live-prd -- --resume runs/live/<file>.json` replays them and pays only for the seats that did not finish.
- The panel, prompts, timing and gate results are saved under `runs/live/`, and the factory page lists every saved run with its cost, time and verdict. The exit code is 0 when every gate passes, 1 when a gate refuses, and 2 when the run fails.
- Only the PRD stage runs live. The factory's later stages are scripted around the recorded PRD's ids, so a live PRD is checked here rather than carried into the factory.

Build output, sandboxes and test bundles go to `runs/`, which git ignores.

### Kodiflex Foundry, the workflow studio

`npm run studio` serves Kodiflex Foundry, a demo for passers-by that costs nothing to run. Pick a domain (healthcare, education, FMCG, financial services, logistics) and a workflow: a feature build (requirements, then code, a failing test, a fix and a release gate) or a document or decision. Each run shows the same pipeline as the live panel: two drafts from Claude and Grok that cannot see each other, crossed reviews in which one catches a serious defect, a merge, plain code checks, and a pause for a person to approve. Every output is written in advance and no model is called. The page shows what each call would cost and how long it would take live, priced from the same table as the live runs, and a "Tokens spent" tile that stays at 0. Link straight to a workflow with `#<id>`, for example `http://127.0.0.1:4320/#fmcg-document`.

The page names models by role, not vendor, so any model can fill one: Model A, the builder (deep reasoning; writes the PRD, design, code and fixes), Model B, the checker (an independent, fast, low-cost model from a different vendor; reviews and writes tests), and Model C, the decider (TypeSafe's Jev decision model: typed yes/no and choice answers with calibrated confidence in about 0.1 s, for a fraction of a cent). Model C routes each request by risk, triages review findings, decides which code-review points to apply, and recommends go or no-go on staging results; a person still makes every approval. With `JEV_API_KEY` set on the server, those four decisions run live on Jev (`jev-latest`) through `GET /api/decide/:workflow/:step`: each step's questions are fixed and built from the workflow, so visitors cannot send their own text; answers are cached for six hours and capped at 500 live calls a day (each costs about $0.00003); and a missing key, an error or the cap falls back to the prepared answer, labelled as a replay with the reason. Where a live answer differs from what the prepared run does next, the page says so. A "low-risk request" button sends a fixed trivial request through the same live router, to show it choosing the cheap path. Build features live in `public/tests.js` as source text plus the one patch that makes each first version, so the page shows the real code and the real fix as a diff, and a "Measure the tests" button runs mutation testing on that code (every comparison, boolean and number nudged, every test re-run) and lists the survivors. Each workflow's panel (both drafts, both reviews, the merge) is replayed from a real recording in `packages/studio/recordings/`, made with `npm run record-panels` (Claude and Grok, nothing planted; `--force` re-records, `--cap=` limits spend). Recorded steps show their real time, tokens and cost, and the remaining estimates are calibrated on them. `npm run compare-gated` runs the same panels with Model C making the routine calls (skip Model B's review on medium-risk work when draft A is judged complete, skip the merge when nothing must be fixed, hand a simple merge to the cheaper model), each only at 70% confidence or more, reusing the recorded steps both pipelines share. Both models then judge the two final versions blind. Measured on all ten: 23% cheaper, 6% slower, and the judges preferred the full panel in 10 of 12 verdicts; only skipping the slow review held up. The page shows each workflow's result after its run. `npm run compare-levers` measures further levers on the same recorded inputs, judged blind by both models against the recorded merge: other Claude models for the merge (Opus 5.5, Sonnet 5.5, Haiku 5.5), a merge that edits draft A, and a faster non-reasoning Grok as Model B. Partial results (4 of 10 workflows, stopped when the xAI account ran out of credit): Opus 5.5 merged as well or better at 23% less cost and 25% less time; Sonnet 5.5 was 65% cheaper but dropped findings; Haiku 5.5 was 97% cheaper and dropped 8; editing draft A was worse and dearer; the fast Grok was 20 to 50 times faster but lost every draft comparison and invented review findings. Following that result, Model A is Claude Opus 5.5 (`CLAUDE_MODEL` in `orchestrator/src/claude.ts`, used by the live PRD run, the recorder and the studio), and the panels were re-recorded with it. The Opus 5 recordings the experiments were measured on are kept in `packages/studio/recordings/opus-5/`. Steps that genuinely run are marked "real code", prepared ones "replay"; the proof box states it is the one complete run so far, lists its attempts, and links its full transcript. The Technical view shows which real model this replay assumes for each role.

A build walks all eight stages of software development, shown as a progress rail with each stage's outcome: PRD (two drafts, crossed reviews, merge, checks, approval), Architecture (Claude designs, Grok reviews, Claude revises, design checks, approval), Code, Code review (Grok reviews, Claude applies or declines each finding), Unit tests (Claude's own), Test cases (Grok, from the PRD, never seeing the code), Testing (one failure, a fix, all passing), and Deployment (release gate, staging, smoke tests, approval, gradual rollout with a rollback plan). Claude's unit tests pass on the code as first written; Grok's independent tests are what catch the bug.

Above the workflows, a proof panel summarises a real, metered run of the requirements panel (`packages/studio/evidence/`), with its per-call costs and a defect Grok caught in Claude's draft, and offers the record for download.

To add a workflow, drop a JSON file in `packages/studio/workflows/`; `workflows.ts` validates it and expands it into steps, and the tests check that every domain has both kinds, that each run has its caught-it moment, and that a build's generated test cases, test script and test run agree. Each workflow ends with its finished output: the document, or for a build the approved requirements, what shipped and the generated tests.

## Layout

| Package | Role |
| --- | --- |
| `packages/domain` | The product rules: CARC table, `appealReady`, timely filing, eligibility, and the synthetic practice seed |
| `packages/rcm` | The denial workbench: workqueue, denial detail, lead summary, eligibility, and the P0 checks run against it |
| `packages/knowledge` | A markdown knowledge pack with front-matter tags, and tag-overlap retrieval over it. Tags match on hyphenated parts and plurals, and a file marked `applies: always` (the PHI policy) is retrieved for every brief |
| `packages/orchestrator` | Run state, gates, panel rules, scanners, fence and trace matrix |
| `packages/implementer` | The fenced sandbox tree that seeds, patches and tests `appealReady` |
| `packages/harness` | The recorded panels and a headless walk of Feature B used by the tests |
| `packages/studio` | The zero-token workflow studio: workflow specs in `workflows/`, their expansion into steps in `workflows.ts`, and its server and page |
| `packages/factory` | The HTTP server and single-page UI that drive a run step by step. `session.ts` runs the stages; `view.ts` turns run state into what the page shows |

The packages are npm workspaces. Each library exports only `src/index.ts`, so other packages import it by name (`import { Run } from "@northwind/orchestrator"`) and cannot reach its other files. `npm install` links them into `node_modules/@northwind/`.

- To use something from another package, export it from that package's `index.ts` and add the package to the importer's `dependencies` (or `devDependencies` when only tests use it).
- Imports inside a package stay relative.
- `harness/src/boundaries.test.ts` fails on a relative import into another package and on an `@northwind/*` import the package does not declare.
- `factory` and `studio` are apps. Nothing imports them, so they have no exports.

## Conventions

- **Synthetic identifiers only.** Use `PAT-###`, `CLM-###` and `DOC-###`. The scanner allowlists these.
- **Frozen clock.** Deadlines and run timestamps use 2026-11-17 so the demo output does not drift.
- **Unknown CARC codes stay `unmapped`.** The product never invents a meaning.
- **Approve the synthesis.** Approval hashes the synthesis, never a single proposal.

## Known gaps

- Only the PRD stage runs live, and only from the command line. Questions, architecture, implementation and test design still replay recordings.
- Clarifying answers and change requests do not regenerate documents.
- Retrieval is still tag matching, not semantic search. A brief that uses a synonym no tag carries ("clinician" for a role) finds nothing for it.
- The isolation check looks for seat markers in prompts the harness writes itself, so it cannot catch a paraphrased leak.
- There is still no login. The request guard stops other websites, not other local processes.
- `FactorySession` still sequences the stages itself. A live model would need that sequencing moved into the orchestrator.
