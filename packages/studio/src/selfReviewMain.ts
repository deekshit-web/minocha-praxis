import { ClaudeModel, callCost, repoRoot } from "@northwind/orchestrator";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS } from "./build.ts";
import { REVIEW_INSTRUCTIONS, Review, panelContext, renderReview } from "./record.ts";
import { DOMAINS, loadSpecs } from "./workflows.ts";

/**
 * Does Claude, reviewing its own work in a fresh context, catch the P0s Grok caught in it? Each case is a real
 * Opus 5.5 artifact from a recording, reviewed with the same instructions Grok had.
 */
const BUILD_REVIEW =
  "Rate each finding P0 (would cause a wrong result, a broken rule or a security problem), P1 (should be fixed) or P2 (optional). Title in at most six words, explain in at most 50, quote the exact text at fault. At most four findings; return none rather than invent one. Name one strength.";
const specs = loadSpecs();
const spec = (id: string) => specs.find((item) => item.id === id)!;
const build = (id: string) => JSON.parse(readFileSync(join(repoRoot(), "packages/studio/recordings/build", `${id}.json`), "utf8"));
const domain = (id: string) => DOMAINS.find((item) => item.id === spec(id).domain)?.name ?? "";
const prd = (id: string) => `The approved PRD:\n${spec(id).recording!.merge.document}\n\nThe module contract:\n${CONTRACTS[id]}`;

const cases = [
  { id: "fmcg-document draft A", wf: "fmcg-document", instructions: REVIEW_INSTRUCTIONS, prompt: `Review this draft. Number findings D-A1, D-A2, ...\n\n${spec("fmcg-document").recording!.draftA}`, grok: renderReview(spec("fmcg-document").recording!.reviewOfA, "D-A") },
  { id: "finance-build architecture", wf: "finance-build", instructions: `Review this architecture against the PRD. ${BUILD_REVIEW} Use ids AR-1, AR-2, ...`, prompt: `${prd("finance-build")}\n\nThe architecture:\n${build("finance-build").architecture.draft}`, grok: build("finance-build").architecture.review },
  { id: "finance-build code", wf: "finance-build", instructions: `Review this code against the PRD and the contract. ${BUILD_REVIEW} Use ids CR-1, CR-2, ...`, prompt: `${prd("finance-build")}\n\nThe code:\n${build("finance-build").code.first}`, grok: build("finance-build").code.review },
  { id: "education-build code", wf: "education-build", instructions: `Review this code against the PRD and the contract. ${BUILD_REVIEW} Use ids CR-1, CR-2, ...`, prompt: `${prd("education-build")}\n\nThe code:\n${build("education-build").code.first}`, grok: build("education-build").code.review },
  { id: "fmcg-build architecture", wf: "fmcg-build", instructions: `Review this architecture against the PRD. ${BUILD_REVIEW} Use ids AR-1, AR-2, ...`, prompt: `${prd("fmcg-build")}\n\nThe architecture:\n${build("fmcg-build").architecture.draft}`, grok: build("fmcg-build").architecture.review },
];

const results = await Promise.all(
  cases.map(async (item) => {
    const seat = { instructions: item.instructions, schema: Review };
    const model = new ClaudeModel(panelContext(spec(item.wf), domain(item.wf)), { analystA: seat, analystB: seat, critiqueOfA: seat, critiqueOfB: seat, synthesizer: seat });
    const answer = await model.complete({ role: "analystA", prompt: item.prompt });
    const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const claude = renderReview(Review.parse(JSON.parse(answer.text)), "D-A");
    return { case: item.id, grok: item.grok, claude, costUsd: callCost(answer.model ?? "claude-opus-5-5", usage) ?? 0 };
  }),
);
writeFileSync(join(repoRoot(), "evals/prd-panel/self-review.json"), JSON.stringify(results, null, 2));
for (const result of results) console.log(`\n### ${result.case} ($${result.costUsd.toFixed(3)})\n--- Grok found:\n${result.grok}\n--- Claude, reviewing its own work:\n${result.claude}`);
console.log(`\nTotal $${results.reduce((total, result) => total + result.costUsd, 0).toFixed(3)}`);
