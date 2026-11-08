import { hashValue } from "./hash.ts";
import { RETURN_TO, canTransition, type ChangeGate, type State } from "./states.ts";

export type Actor = "agent" | "orchestrator" | "human";

export type Gate = "prd" | "architecture" | "test_cases";

export interface TransitionRecord {
  from: State;
  to: State;
  actor: Actor;
  revision: number;
  at: string;
  note?: string;
}

export interface Approval {
  gate: Gate;
  artifactHash: string;
  decision: "approve" | "changes";
  comment?: string;
  actor: "human";
  at: string;
}

export interface Artifact {
  name: string;
  hash: string;
  body: unknown;
  revision: number;
}

export class TransitionError extends Error {}

export class Run {
  state: State = "intake";
  revision = 0;
  history: TransitionRecord[] = [];
  approvals: Approval[] = [];
  artifacts = new Map<string, Artifact>();
  blockedReason: string | null = null;
  returnTo: State | null = null;

  constructor(
    readonly id: string,
    private readonly now: () => string = () => "2026-11-17T00:00:00Z",
  ) {}

  transition(to: State, actor: Actor, note?: string): void {
    if (this.state === "changes_requested" && to !== "blocked" && to !== this.returnTo) {
      throw new TransitionError(`Changes from this gate return to ${this.returnTo}, not ${to}`);
    }
    if (!canTransition(this.state, to)) throw new TransitionError(`Illegal transition ${this.state} -> ${to}`);
    this.revision += 1;
    this.history.push({ from: this.state, to, actor, revision: this.revision, at: this.now(), note });
    this.state = to;
    if (to !== "blocked") this.blockedReason = null;
    if (to !== "changes_requested") this.returnTo = null;
  }

  block(reason: string): void {
    this.blockedReason = reason;
    this.transition("blocked", "orchestrator", reason);
  }

  putArtifact(name: string, body: unknown): string {
    const hash = hashValue(body);
    this.artifacts.set(name, { name, hash, body, revision: this.revision });
    return hash;
  }

  approve(gate: Gate, artifactName: string, decision: "approve" | "changes", comment?: string): void {
    const artifact = this.artifacts.get(artifactName);
    if (!artifact) throw new Error(`Missing artifact ${artifactName}`);
    this.approvals.push({ gate, artifactHash: artifact.hash, decision, comment, actor: "human", at: this.now() });
  }

  /** True only when the latest approval for the gate still matches the artifact the human would see. */
  approvalMatches(gate: Gate, artifactName: string): boolean {
    const artifact = this.artifacts.get(artifactName);
    if (!artifact) return false;
    const latest = [...this.approvals].reverse().find((item) => item.gate === gate && item.decision === "approve");
    return latest?.artifactHash === artifact.hash;
  }

  requestChanges(from: ChangeGate, comment?: string): void {
    this.returnTo = RETURN_TO[from];
    const gate = from === "prd_gate" ? "prd" : from === "architecture_gate" ? "architecture" : "test_cases";
    const artifactName = gate === "test_cases" ? "test_cases" : gate;
    if (this.artifacts.has(artifactName)) this.approve(gate, artifactName, "changes", comment);
    this.transition("changes_requested", "human", comment);
  }
}
