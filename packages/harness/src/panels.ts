import { join } from "node:path";
import { CARC_RULES, carcRule, type CarcCode } from "@northwind/domain";
import { citationPaths, loadPack, relevant } from "@northwind/knowledge";
import {
  SEAT,
  STAGE_METHODS,
  buildSeatPrompt,
  intakeNouns,
  repoRoot,
  type Architecture,
  type AttributeFinding,
  type ImplementationPlan,
  type PanelCall,
  type PanelCritique,
  type PanelStage,
  type Prd,
  type QuestionSet,
  type ReviewPanel,
  type TestCaseSet,
} from "@northwind/orchestrator";

export const FEATURE_B_BRIEF =
  "On CO-50 medical-necessity denials, the specialist must not mark the appeal packet ready unless a clinical-note reference and a filing-deadline date are both present.";

/**
 * A document may cite a pack file only when retrieval finds it relevant to the brief: an always-on policy or a tag match.
 * The pack is read from disk, so a deleted or renamed file stops counting.
 */
export function groundedCitations(brief: string): Set<string> {
  return citationPaths(relevant(loadPack(join(repoRoot(), "packages/knowledge/pack")), intakeNouns(brief)));
}

export const FEATURE_C_CITATIONS = ["pack/decisions/ADR-001-patient-and-coverage.md"];

function ref(code: CarcCode): { code: CarcCode; nextAction: string } {
  return { code, nextAction: carcRule(code)!.nextAction };
}

function attributeNotes(stage: PanelStage, note: string, unmet: AttributeFinding["attribute"][] = []): AttributeFinding[] {
  return STAGE_METHODS[stage].attributes.map((attribute) => ({
    attribute,
    met: !unmet.includes(attribute),
    note,
  }));
}

function critique(stage: PanelStage, of: "A" | "B", author: "A" | "B", point: string): PanelCritique {
  return { of, author, strengths: [point], defects: [], adopt: [point], reject: [], attributes: attributeNotes(stage, point) };
}

export function panelCalls<T>(panel: ReviewPanel<T>, brief: string): PanelCall[] {
  return [
    { role: "analystA", prompt: buildSeatPrompt("analystA", brief) },
    { role: "analystB", prompt: buildSeatPrompt("analystB", brief) },
    { role: "critiqueOfA", prompt: buildSeatPrompt("critiqueOfA", brief, { proposalA: panel.proposalA }) },
    { role: "critiqueOfB", prompt: buildSeatPrompt("critiqueOfB", brief, { proposalB: panel.proposalB }) },
    {
      role: "synthesizer",
      prompt: buildSeatPrompt("synthesizer", brief, {
        proposalA: panel.proposalA,
        proposalB: panel.proposalB,
        critiqueOfA: panel.critiqueOfA,
        critiqueOfB: panel.critiqueOfB,
      }),
    },
  ];
}

function agreed<T>(stage: ReviewPanel<T>["stage"], proposal: T, fromA: string, fromB: string): ReviewPanel<T> {
  return {
    stage,
    proposalA: proposal,
    proposalB: structuredClone(proposal),
    critiqueOfA: critique(stage, "A", "B", fromA),
    critiqueOfB: critique(stage, "B", "A", fromB),
    synthesis: structuredClone(proposal),
    rationale: {
      takenFromA: [fromA],
      takenFromB: [fromB],
      rejected: [],
      defects: [],
      attributes: attributeNotes(stage, `${fromA} ${fromB}`),
    },
  };
}

export function questionPanel(): ReviewPanel<QuestionSet> {
  const questions: QuestionSet = {
    questions: [
      {
        id: "Q-1",
        prompt: "Which denial group does the new gate apply to?",
        why: "A wider gate changes which remits the specialist can block.",
        options: [
          { id: "co50", label: "CO-50 only", consequence: "CO-16 and CO-197 keep their current path." },
          { id: "all-denials", label: "Every denial class", consequence: "Patient-responsibility codes stay excluded." },
        ],
        defaultOptionId: "co50",
      },
      {
        id: "Q-2",
        prompt: "Who may override the gate?",
        why: "An override is a different control and a different test.",
        options: [
          { id: "nobody", label: "Nobody in v1", consequence: "The ready action stays disabled until both fields are present." },
          { id: "lead", label: "PFS lead", consequence: "The lead needs a separate permission and an audit row." },
        ],
        defaultOptionId: "nobody",
      },
      {
        id: "Q-3",
        prompt: "What counts as a clinical-note reference?",
        why: "An upload would add storage and a PHI path this demo does not have.",
        options: [
          { id: "doc-id", label: "A non-empty DOC-### id", consequence: "The field is an identifier, not a document body." },
          { id: "upload", label: "An uploaded note", consequence: "Out of scope for the demo." },
        ],
        defaultOptionId: "doc-id",
      },
      {
        id: "Q-4",
        prompt: "Which date is the deadline?",
        why: "Northwind's pack fixes timely filing at 90 days from the date of service.",
        options: [
          { id: "dos-90", label: "Date of service plus 90 days", consequence: "A blank deadline fails the gate." },
          { id: "received", label: "Date the remit was received", consequence: "That date is not in the fixture." },
        ],
        defaultOptionId: "dos-90",
      },
      {
        id: "Q-5",
        prompt: "What should the specialist see when blocked?",
        why: "A silent disabled button does not satisfy the acceptance criterion.",
        options: [
          { id: "named", label: "Name the missing items on the button", consequence: "The then-clause can be observed." },
          { id: "generic", label: "Say only that the packet is incomplete", consequence: "The criterion would not be testable." },
        ],
        defaultOptionId: "named",
      },
    ],
  };
  return agreed("questions", questions, "Five questions, CO-50 only.", "Defaults match the pack.");
}

export function featureBPrd(): Prd {
  return {
    problem:
      "Specialists can mark a CO-50 appeal ready without the clinical-note reference and filing deadline the payer packet needs.",
    users: ["Denial specialist", "PFS lead"],
    inScope: ["CO-50 readiness gate", "Named missing items", "PR-1 kept off the appeal path"],
    outOfScope: ["Diagnosis changes", "Real clearinghouse submit", "Lead override"],
    assumptions: [
      { answerId: "Q-1", text: "The gate applies to CO-50 only." },
      { answerId: "Q-2", text: "Nobody can override the gate in v1." },
      { answerId: "Q-3", text: "A clinical-note reference is a non-empty DOC-### id." },
      { answerId: "Q-4", text: "The deadline is the date of service plus 90 days, and a blank deadline is missing." },
      { answerId: "Q-5", text: "The blocked action names the missing items." },
    ],
    requirements: [
      {
        id: "REQ-1",
        statement: "A CO-50 denial can be marked appeal-ready only when a clinical-note reference and a filing deadline are both present.",
        rationale: "Those are the two fields the packet checker will look for.",
      },
      {
        id: "REQ-2",
        statement: "CO-16, CO-197, and CO-4 are unchanged by this gate.",
        rationale: "The question round limited the gate to CO-50.",
      },
      {
        id: "REQ-3",
        statement: "PR-1 and OA-23 cannot be marked appeal-ready.",
        rationale: "The demo table classes them as patient responsibility and informational.",
      },
      {
        id: "REQ-4",
        statement: "When the gate blocks, the specialist sees the names of the missing items.",
        rationale: "A disabled control with no reason cannot be tested from the scenario.",
      },
    ],
    acceptanceCriteria: [
      {
        id: "AC-1",
        requirementId: "REQ-1",
        given: "A CO-50 denial with no clinical-note reference and a filing deadline",
        when: "The specialist marks the appeal ready",
        then: "The packet stays not ready and the missing item is the clinical-note reference",
        priority: "P0",
      },
      {
        id: "AC-2",
        requirementId: "REQ-1",
        given: "A CO-50 denial with a clinical-note reference and no filing deadline",
        when: "The specialist marks the appeal ready",
        then: "The packet stays not ready and the missing item is the filing deadline",
        priority: "P0",
      },
      {
        id: "AC-3",
        requirementId: "REQ-1",
        given: "A CO-50 denial with both a clinical-note reference and a filing deadline",
        when: "The specialist marks the appeal ready",
        then: "The packet becomes appeal-ready",
        priority: "P0",
      },
      {
        id: "AC-4",
        requirementId: "REQ-2",
        given: "A CO-16 denial with neither field",
        when: "The specialist marks the appeal ready",
        then: "This gate does not require a clinical-note reference",
        priority: "P0",
      },
      {
        id: "AC-5",
        requirementId: "REQ-3",
        given: "A PR-1 deductible line",
        when: "The specialist looks for the appeal action",
        then: "The line is not appealable",
        priority: "P0",
      },
      {
        id: "AC-6",
        requirementId: "REQ-4",
        given: "A blocked CO-50 denial",
        when: "The specialist reads the ready action",
        then: "The missing field names are visible",
        priority: "P1",
      },
    ],
    scenarios: [
      {
        id: "SCN-1",
        criterionIds: ["AC-1"],
        role: "Denial specialist",
        startingState: "CO-50 denial DEN-01 has a deadline and no DOC id",
        steps: ["Open the denial", "Choose mark ready"],
        expected: "Ready stays off and clinical-note reference is named",
      },
      {
        id: "SCN-2",
        criterionIds: ["AC-2"],
        role: "Denial specialist",
        startingState: "CO-50 denial has DOC-014 and a blank deadline",
        steps: ["Open the denial", "Choose mark ready"],
        expected: "Ready stays off and filing deadline is named",
      },
      {
        id: "SCN-3",
        criterionIds: ["AC-3"],
        role: "Denial specialist",
        startingState: "CO-50 denial has DOC-003 and a deadline",
        steps: ["Open the denial", "Choose mark ready"],
        expected: "The denial becomes appeal-ready",
      },
      {
        id: "SCN-4",
        criterionIds: ["AC-4"],
        role: "Denial specialist",
        startingState: "Workqueue contains a CO-16 denial",
        steps: ["Filter to denials", "Open the CO-16 row", "Choose mark ready"],
        expected: "The CO-50 note rule is not applied",
      },
      {
        id: "SCN-5",
        criterionIds: ["AC-5"],
        role: "Denial specialist",
        startingState: "A PR-1 line is on the remit",
        steps: ["Open the line"],
        expected: "No appeal-ready action is offered",
      },
      {
        id: "SCN-6",
        criterionIds: ["AC-6"],
        role: "PFS lead",
        startingState: "Summary is open and a CO-50 row is blocked",
        steps: ["Open the blocked denial"],
        expected: "The missing item names are on the screen",
      },
    ],
    screens: [
      { id: "SCR-1", title: "Workqueue", purpose: "Find the denial and its deadline risk", scenarioIds: ["SCN-4"] },
      {
        id: "SCR-2",
        title: "Denial detail",
        purpose: "Read the next action and the checklist",
        scenarioIds: ["SCN-1", "SCN-2", "SCN-3", "SCN-5"],
      },
      { id: "SCR-3", title: "Lead summary", purpose: "Count lines by CARC class", scenarioIds: ["SCN-6"] },
    ],
    openQuestions: [],
    citations: ["pack/carc-demo.md", "pack/payer-northwind.md", "pack/phi-policy.md", "pack/roles.md"],
    carcReferences: [ref("CO-50"), ref("CO-16"), ref("PR-1")],
  };
}

export function prdPanel(): ReviewPanel<Prd> {
  return agreed("prd", featureBPrd(), "CO-50 criteria are observable.", "PR-1 stays off the appeal path.");
}

function architectureBody(fence: string[], moduleName: string, testKind: "unit" | "e2e", decision: "accept" | "reject" | "pending", appliedChange: string): Architecture {
  const criteria = featureBPrd().acceptanceCriteria.map((criterion) => criterion.id);
  return {
    context: "One practice. The readiness rule is a pure function the detail screen calls.",
    modules: [
      { name: moduleName, responsibility: "Decide whether a CO-50 packet is appeal-ready." },
      { name: "DenialDetail", responsibility: "Show the checklist and the named missing items." },
    ],
    dataModel: [
      { entity: "Denial", fields: ["id", "carc", "clinicalNoteRef", "filingDeadline"] },
    ],
    requirementMap: criteria.map((acceptanceCriterionId) => ({
      acceptanceCriterionId,
      module: acceptanceCriterionId === "AC-6" || acceptanceCriterionId === "AC-4" ? "DenialDetail" : moduleName,
      testKind: acceptanceCriterionId === "AC-6" ? "e2e" : testKind,
    })),
    fileFence: fence,
    suggestions: [
      {
        id: "S-1",
        text: "Keep appealReady in packages/domain so AC-1 runs without a browser.",
        impact: "The file fence gains packages/domain and AC-1 is a unit test.",
        decision,
        appliedChange,
      },
    ],
    risks: ["A component-local rule cannot be the unit oracle."],
    phiNote: "Synthetic PAT, CLM, and DOC identifiers only.",
    citations: ["pack/carc-demo.md", "pack/patterns/detail-checklist.md", "pack/phi-policy.md"],
    carcReferences: [ref("CO-50"), ref("PR-1")],
  };
}

export function architecturePanel(): ReviewPanel<Architecture> {
  const proposalA = architectureBody(["packages/rcm/**"], "DenialDetail", "e2e", "reject", "");
  proposalA.modules = [{ name: "DenialDetail", responsibility: "Decide readiness in the component and render the checklist." }];
  proposalA.requirementMap = proposalA.requirementMap.map((item) => ({
    ...item,
    module: "DenialDetail",
    testKind: "e2e" as const,
  }));
  const proposalB = architectureBody(
    ["packages/domain/**", "packages/rcm/**"],
    "AppealReadiness",
    "unit",
    "pending",
    "",
  );
  const synthesis = architectureBody(
    ["packages/domain/**", "packages/rcm/**"],
    "AppealReadiness",
    "unit",
    "pending",
    "File fence includes packages/domain. AC-1, AC-2, AC-3, and AC-5 map to a unit test of appealReady.",
  );
  return {
    stage: "architecture",
    proposalA,
    proposalB,
    critiqueOfA: {
      of: "A",
      author: "B",
      strengths: ["The patch touches one screen."],
      defects: [
        {
          id: "D-A1",
          severity: "P0",
          code: "UNTESTABLE",
          attribute: "accuracy",
          point: "CO-50 readiness inside the component cannot run AC-CO50-NOTE without a browser.",
        },
        {
          id: "D-A2",
          severity: "P1",
          code: "OTHER",
          attribute: "maintainability",
          point: "The next screen would copy the rule instead of calling one function.",
        },
      ],
      adopt: [],
      reject: ["Component-local rule"],
      attributes: [
        { attribute: "security", met: true, note: "No new identifier and no payer call. Synthetic ids stay the only keys." },
        { attribute: "accuracy", met: false, note: "AC-CO50-NOTE cannot run without a browser, so the gate can drift from the test." },
        { attribute: "maintainability", met: false, note: "A component-local rule gets copied into the next screen." },
      ],
    },
    critiqueOfB: {
      of: "B",
      author: "A",
      strengths: ["appealReady can fail the unit oracle directly."],
      defects: [
        {
          id: "D-B1",
          severity: "P1",
          code: "OTHER",
          attribute: "maintainability",
          point: "The domain package is an extra boundary for a small rule.",
        },
      ],
      adopt: ["Domain function"],
      reject: [],
      attributes: [
        { attribute: "security", met: true, note: "The pure function takes ids and dates. It does not read a note body." },
        { attribute: "accuracy", met: true, note: "The unit test can fail AC-CO50-NOTE on the seeded bug." },
        { attribute: "maintainability", met: true, note: "One function is the rule. The screen only calls it." },
      ],
    },
    synthesis,
    rationale: {
      takenFromA: [],
      takenFromB: ["packages/domain file fence", "unit test for the CO-50 gate"],
      rejected: ["component-local rule"],
      defects: [
        { defectId: "D-A1", disposition: "resolved" },
        { defectId: "D-A2", disposition: "resolved" },
        { defectId: "D-B1", disposition: "resolved" },
      ],
      attributes: [
        { attribute: "security", met: true, note: "PHI note stays synthetic ids only. The fence does not include a secret or the factory." },
        { attribute: "accuracy", met: true, note: "appealReady is the unit under AC-CO50-NOTE, so the seeded bug is visible." },
        { attribute: "maintainability", met: true, note: "The screen calls the domain function. The rule is not copied into the component." },
      ],
    },
  };
}

export function implementationPanel(): ReviewPanel<ImplementationPlan> {
  const plan: ImplementationPlan = {
    summary: "Change appealReady so a CO-50 without a clinical-note reference is not ready. Leave the UI calling that function.",
    files: ["packages/domain/src/appealReady.ts"],
    assertionIds: ["AC-CO50-NOTE", "AC-CO50-DEADLINE", "AC-CO50-READY", "AC-PR1-NOT-DENIAL"],
  };
  return agreed("implementation", plan, "Edit the domain function only.", "Keep the assertion ids.");
}

export function testCasePanel(): ReviewPanel<TestCaseSet> {
  const cases: TestCaseSet = {
    cases: [
      {
        id: "TC-1",
        scenarioIds: ["SCN-1"],
        priority: "P0",
        preconditions: "DEN-01 is a CO-50 with a deadline and no note",
        steps: ["Open the denial", "Mark ready"],
        expected: "Not ready, clinical-note reference named",
        automation: "e2e",
      },
      {
        id: "TC-2",
        scenarioIds: ["SCN-2"],
        priority: "P0",
        preconditions: "CO-50 with DOC-014 and no deadline",
        steps: ["Open the denial", "Mark ready"],
        expected: "Not ready, filing deadline named",
        automation: "e2e",
      },
      {
        id: "TC-3",
        scenarioIds: ["SCN-3"],
        priority: "P0",
        preconditions: "CO-50 with note and deadline",
        steps: ["Mark ready"],
        expected: "Appeal-ready",
        automation: "unit",
      },
      {
        id: "TC-4",
        scenarioIds: ["SCN-4"],
        priority: "P0",
        preconditions: "CO-16 denial",
        steps: ["Mark ready"],
        expected: "Gate does not require a note",
        automation: "unit",
      },
      {
        id: "TC-5",
        scenarioIds: ["SCN-5"],
        priority: "P0",
        preconditions: "PR-1 line",
        steps: ["Open the line"],
        expected: "Not appealable",
        automation: "unit",
      },
      {
        id: "TC-6",
        scenarioIds: ["SCN-6"],
        priority: "P1",
        preconditions: "Blocked CO-50",
        steps: ["Read the action"],
        expected: "Missing names visible",
        automation: "e2e",
      },
      {
        id: "TC-99",
        scenarioIds: ["SCN-404"],
        priority: "P1",
        preconditions: "Invented",
        steps: ["Nope"],
        expected: "Dropped because the scenario is not in the PRD",
        automation: "e2e",
      },
    ],
  };
  return agreed("test_design", cases, "One case per scenario.", "Drop anything the PRD did not ask for.");
}

export function playwrightTitles(): string[] {
  return [
    "TC-1 CO-50 missing note blocks ready",
    "TC-2 CO-50 missing deadline blocks ready",
    "TC-3 CO-50 complete packet is ready",
    "TC-4 CO-16 is outside the note gate",
    "TC-5 PR-1 is not an appeal",
  ];
}

export const RULES = CARC_RULES;

export function leakedAnalystPrompt(brief: string): PanelCall[] {
  const calls = panelCalls(architecturePanel(), brief);
  const analystB = calls.find((call) => call.role === "analystB")!;
  analystB.prompt = `${analystB.prompt}\n${SEAT.proposalA}\n{"fileFence":["packages/rcm/**"]}`;
  return calls;
}
