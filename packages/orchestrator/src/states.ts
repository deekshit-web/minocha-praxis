export const MAIN_LINE = [
  "intake",
  "clarifying",
  "prd_draft",
  "prd_gate",
  "architecture_draft",
  "architecture_gate",
  "implementing",
  "unit_loop",
  "test_design",
  "test_gate",
  "automating",
  "e2e",
  "deploy_gate",
  "deployed",
] as const;

export type MainState = (typeof MAIN_LINE)[number];

export type State = MainState | "changes_requested" | "blocked" | "abandoned";

export const TRANSITIONS: Record<State, readonly State[]> = {
  intake: ["clarifying", "blocked"],
  clarifying: ["clarifying", "prd_draft", "blocked"],
  prd_draft: ["prd_gate", "blocked"],
  prd_gate: ["architecture_draft", "changes_requested", "blocked"],
  changes_requested: ["prd_draft", "architecture_draft", "test_design", "blocked"],
  architecture_draft: ["architecture_gate", "blocked"],
  architecture_gate: ["implementing", "changes_requested", "blocked"],
  implementing: ["unit_loop", "blocked"],
  unit_loop: ["unit_loop", "test_design", "blocked"],
  test_design: ["test_gate", "blocked"],
  test_gate: ["automating", "changes_requested", "blocked"],
  automating: ["e2e", "blocked"],
  e2e: ["deploy_gate", "blocked"],
  deploy_gate: ["deployed", "blocked"],
  deployed: [],
  blocked: [],
  abandoned: [],
};

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to);
}

export const RETURN_TO = {
  prd_gate: "prd_draft",
  architecture_gate: "architecture_draft",
  test_gate: "test_design",
} as const;

export type ChangeGate = keyof typeof RETURN_TO;
