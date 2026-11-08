# Northwind gated delivery demo

A worked example of an agent-driven delivery pipeline with human approval gates, built around one small feature in a synthetic medical-billing product.

The feature, "Feature B": on a CO-50 (medical-necessity) denial, the specialist must not mark the appeal packet ready unless a clinical-note reference and a filing deadline are both present.

The demo walks that feature from intake to a recorded release. It goes through clarifying questions, a requirements document (PRD), an architecture review, a red-then-green unit loop, test design and a traceability check. A person approves each gate, and deterministic checks decide whether the run may move on.

## What is recorded and what is enforced

Read this before anything else.

**Every model step is recorded.** No language model is called. Each stage replays fixed JSON through `FixturePlayer` (`packages/orchestrator/src/provider.ts`). The live seat, `UnconfiguredModel`, throws `model-not-configured`. In most stages the two "independent" analyst proposals are the same document, and the UI says so. The repair is a fixed patch that removes a bug the demo planted. The clarifying questions only accept the suggested answers, because the recorded PRD was written for them.

**The gates are real code and are tested.** These checks run on every walk and do not trust the recorded content:

| Check | Where | What it refuses |
| --- | --- | --- |
| Hash-bound approval | `orchestrator/src/run.ts` | An approval no longer counts once the approved document changes |
| State machine | `orchestrator/src/states.ts` | Any transition not in the table, including a change request returning to the wrong draft |
| Panel review | `orchestrator/src/panel.ts` | Missing seats, analysts that saw a proposal, unresolved P0 defects, quality attributes with no note |
| File fence | `orchestrator/src/fence.ts` | Writes outside the approved globs, and any fence that admits the factory, the gates, the tooling or secret files |
| Assertion guard | `implementer/src/tree.ts` | A test-file write that deletes a required assertion id |
| Execution gate | `orchestrator/src/method.ts` | A review that calls a red test accurate |
| Mutation oracle | `orchestrator/src/method.ts` | A test case that still passes with the known bug present |
| Stall detection | `orchestrator/src/stall.ts` | A repeated diff-and-failure fingerprint, or a third failing attempt |
| Intake scan | `orchestrator/src/phi.ts` | A brief containing an SSN, email, phone number, MRN or labelled date of birth |
| Deploy gate | `orchestrator/src/deploy.ts`, `harness/src/walk.ts` | Stale approvals, a red unit run, a red P0 case, or PHI or secrets anywhere in the run's stored output |
| Request guard | `rcm/src/workbench.ts` | On both servers, a `Host` that is not loopback, and a POST whose `Origin` is another site |

The unit loop is also real. The implementer seeds a sandbox copy under `runs/implementer/`, bundles the test with esbuild, and runs it under `node:test`. The P0 cases run against a live workbench server.

The PHI and secret scanners are regex demos. They do not detect names, unlabelled dates of birth, addresses or member ids. Use synthetic data only.

## Running it

You need Node 22 on Linux x64. The repo ships a pinned esbuild 0.15.18 binary in `tools/esbuild/`, so the scripts have no other dependencies. They do not run on macOS, Windows or ARM yet.

```sh
npm run harness   # bundle and run every *.test.ts under node:test
npm run rcm       # denial workbench on http://127.0.0.1:4173
npm run factory   # factory UI on http://127.0.0.1:4317
```

Without npm, run the same scripts directly, for example `node scripts/harness.mjs`.

For the full demo, start the workbench first, then the factory. If the workbench runs somewhere else, set `NORTHWIND_WORKBENCH` (for example `http://127.0.0.1:5173`) when starting the factory. In the factory, step through Begin intake → answers → approve PRD → accept suggestion S-1 → approve architecture → apply the repair → approve tests → record. The trace links open the matching workbench pages. Reset clears the factory session, its sandbox and the workbench ready marks.

esbuild strips types without checking them, so type errors only show up in the typecheck. It is the only step that needs installed packages:

```sh
npm install
npm run typecheck
```

Build output, sandboxes and test bundles go to `runs/`, which git ignores.

## Layout

| Package | Role |
| --- | --- |
| `packages/domain` | The product rules: CARC table, `appealReady`, timely filing, eligibility, and the synthetic practice seed |
| `packages/rcm` | The denial workbench: workqueue, denial detail, lead summary, eligibility, and the P0 checks run against it |
| `packages/knowledge` | A markdown knowledge pack with front-matter tags, and tag-overlap retrieval over it |
| `packages/orchestrator` | Run state, gates, panel rules, scanners, fence and trace matrix |
| `packages/implementer` | The fenced sandbox tree that seeds, patches and tests `appealReady` |
| `packages/harness` | The recorded panels and a headless walk of Feature B used by the tests |
| `packages/factory` | The HTTP server and single-page UI that drive a run step by step |

Packages import each other by relative path (`../../orchestrator/src/...`). The `package.json` names are labels, not installed workspaces.

## Conventions

- **Synthetic identifiers only.** Use `PAT-###`, `CLM-###` and `DOC-###`. The scanner allowlists these.
- **Frozen clock.** Deadlines and run timestamps use 2026-11-17 so the demo output does not drift.
- **Unknown CARC codes stay `unmapped`.** The product never invents a meaning.
- **Approve the synthesis.** Approval hashes the synthesis, never a single proposal.

## Known gaps

- No live model. Wiring one into `ModelProvider` is the real test of whether the gates hold.
- Clarifying answers and change requests do not regenerate documents.
- The isolation check looks for seat markers in prompts the harness writes itself, so it cannot catch a paraphrased leak.
- There is still no login. The request guard stops other websites, not other local processes.
- `packages/factory/src/session.ts` mixes orchestration with view rendering.
