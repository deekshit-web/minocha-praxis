import * as z from "zod/v4";
import type { Prd } from "./documents.ts";
import { QUALITY_ATTRIBUTES, type AttributeFinding } from "./method.ts";
import { DEFECT_CODES, type PanelCritique, type SynthesisRationale } from "./panel.ts";

/**
 * Response shapes a live model is held to. Each one is typed against the document interface,
 * so the typecheck fails if a schema and the type the gates read drift apart.
 */
const AttributeFindingSchema: z.ZodType<AttributeFinding> = z.object({
  attribute: z.enum(QUALITY_ATTRIBUTES),
  met: z.boolean(),
  note: z.string(),
});

export const PrdSchema: z.ZodType<Prd> = z.object({
  problem: z.string(),
  users: z.array(z.string()),
  inScope: z.array(z.string()),
  outOfScope: z.array(z.string()),
  assumptions: z.array(z.object({ answerId: z.string(), text: z.string() })),
  requirements: z.array(z.object({ id: z.string(), statement: z.string(), rationale: z.string() })),
  acceptanceCriteria: z.array(
    z.object({
      id: z.string(),
      requirementId: z.string(),
      given: z.string(),
      when: z.string(),
      then: z.string(),
      priority: z.enum(["P0", "P1"]),
    }),
  ),
  scenarios: z.array(
    z.object({
      id: z.string(),
      criterionIds: z.array(z.string()),
      role: z.string(),
      startingState: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
    }),
  ),
  screens: z.array(z.object({ id: z.string(), title: z.string(), purpose: z.string(), scenarioIds: z.array(z.string()) })),
  openQuestions: z.array(z.object({ id: z.string(), text: z.string() })),
  citations: z.array(z.string()),
  carcReferences: z.array(z.object({ code: z.string(), nextAction: z.string() })),
});

export const CritiqueSchema: z.ZodType<PanelCritique> = z.object({
  of: z.enum(["A", "B"]),
  author: z.enum(["A", "B"]),
  strengths: z.array(z.string()),
  defects: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["P0", "P1"]),
      code: z.enum(DEFECT_CODES),
      point: z.string(),
      attribute: z.enum(QUALITY_ATTRIBUTES).optional(),
    }),
  ),
  adopt: z.array(z.string()),
  reject: z.array(z.string()),
  attributes: z.array(AttributeFindingSchema),
});

const RationaleSchema: z.ZodType<SynthesisRationale> = z.object({
  takenFromA: z.array(z.string()),
  takenFromB: z.array(z.string()),
  rejected: z.array(z.string()),
  defects: z.array(z.object({ defectId: z.string(), disposition: z.enum(["resolved", "unresolved"]) })),
  attributes: z.array(AttributeFindingSchema),
});

/** The synthesizer returns the merged document and the reasons, the shape playPanel unwraps. */
export function synthesisSchema<T>(document: z.ZodType<T>): z.ZodType<{ synthesis: T; rationale: SynthesisRationale }> {
  return z.object({ synthesis: document, rationale: RationaleSchema });
}
