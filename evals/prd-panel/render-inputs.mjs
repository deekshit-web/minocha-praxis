// Renders the eval inputs as one page for review: node evals/prd-panel/render-inputs.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const partA = read("part-a.json").cases;
const partB = read("part-b.json").briefs;

const edit = (change) =>
  "append" in change
    ? `<p class="where">Adds to ${esc(change.section)}:</p><p class="after">${esc(JSON.stringify(change.append))}</p>`
    : `<p class="where">${esc(change.id)} · ${esc(change.field)}</p><p class="before">${esc(change.find)}</p><p class="after">${esc(change.replace)}</p>`;

const caseHtml = (item) => `
  <section class="case ${item.kind}">
    <h3>${esc(item.id)} <span class="tag">${item.kind === "seeded" ? esc(item.defect) : "clean control"}</span> <span class="base">base: ${esc(item.base)}</span></h3>
    <p><b>${item.kind === "seeded" ? "A reviewer should notice:" : "Expected:"}</b> ${esc(item.notice)}</p>
    ${item.edits.map(edit).join("") || '<p class="where">Unchanged base.</p>'}
  </section>`;

const briefHtml = (item) => `
  <section class="case brief">
    <h3>${esc(item.id)} <span class="tag">${esc(item.topic)}</span></h3>
    <p class="brief-text">${esc(item.brief)}</p>
    <p class="where">Decisions (stand in for the question round)</p>
    <ul>${item.answers.map((a) => `<li><b>${esc(a.id)}</b> ${esc(a.question)} <i>${esc(a.answer)}</i></li>`).join("")}</ul>
    <p class="where">What the jury checks in the final PRD</p>
    <ol>${item.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
  </section>`;

writeFileSync(
  join(dir, "inputs.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRD panel eval inputs</title>
<style>
  body { margin: 0; padding: 24px 16px 64px; background: #f3ecdf; color: #1c1915; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font: 32px/1.1 Palatino, Georgia, serif; font-weight: 500; margin: 0 0 6px; }
  h2 { margin: 32px 0 8px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #084743; }
  .lead { color: #5e564c; margin: 0 0 4px; }
  .case { background: #fffaf3; border: 1px solid #e3d5c3; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .case.clean { border-style: dashed; }
  h3 { margin: 0 0 6px; font-size: 16px; }
  .tag { font-size: 12px; font-weight: 650; background: #e3f1e7; color: #2a6840; border-radius: 999px; padding: 1px 8px; margin-left: 6px; }
  .seeded .tag { background: #f6e3dd; color: #8d3d2c; }
  .base { font-size: 12px; color: #5e564c; font-weight: 400; margin-left: 6px; }
  .where { margin: 8px 0 2px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #5e564c; }
  .before, .after { margin: 2px 0; padding: 6px 10px; border-radius: 6px; }
  .before { background: #f6e3dd; text-decoration: line-through; text-decoration-color: rgba(141,61,44,.45); }
  .after { background: #e3f1e7; }
  .brief-text { font-size: 16px; }
  ul, ol { margin: 4px 0 0; padding-left: 20px; }
</style></head><body><main>
<h1>PRD panel eval: inputs for review</h1>
<p class="lead">Part A plants one defect in a known PRD. Every planted defect passes all code gates, so only a reviewer can catch it. Clean controls measure false alarms.</p>
<p class="lead">Part B runs new briefs end to end through four setups: single draft, self-review, all-Claude panel, Claude + Grok panel.</p>
<h2>Part A · ${partA.filter((c) => c.kind === "seeded").length} planted defects, ${partA.filter((c) => c.kind === "clean").length} clean controls</h2>
${partA.map(caseHtml).join("")}
<h2>Part B · ${partB.length} new briefs</h2>
${partB.map(briefHtml).join("")}
</main></body></html>
`,
);
console.log(join(dir, "inputs.html"));
