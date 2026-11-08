export const CARC_CODES = ["CO-16", "CO-50", "CO-197", "CO-4", "PR-1", "OA-23"] as const;

export type CarcCode = (typeof CARC_CODES)[number];

export type CarcClass = "denial" | "patient-responsibility" | "informational";

export interface CarcRule {
  code: CarcCode;
  group: "CO" | "PR" | "OA";
  reason: string;
  meaning: string;
  carcClass: CarcClass;
  nextAction: string;
  /** Remark on Northwind's synthetic remit. A real 835 remark wins over this pairing. */
  demoRarc: string;
}

export const CARC_RULES: readonly CarcRule[] = [
  {
    code: "CO-16",
    group: "CO",
    reason: "16",
    meaning: "Claim/service lacks information or has a submission or billing error.",
    carcClass: "denial",
    nextAction: "Correct the missing element named by the remark and resubmit the claim.",
    demoRarc: "MA130",
  },
  {
    code: "CO-50",
    group: "CO",
    reason: "50",
    meaning: "These are non-covered services because this is not deemed a medical necessity by the payer.",
    carcClass: "denial",
    nextAction:
      "Appeal with the coverage policy and a clinical-note reference. Do not change the diagnosis code in this product.",
    demoRarc: "N115",
  },
  {
    code: "CO-197",
    group: "CO",
    reason: "197",
    meaning: "Precertification, authorization, or notification is absent.",
    carcClass: "denial",
    nextAction:
      "Attach the authorization reference if one exists. Otherwise route to the authorization desk for a retro request.",
    demoRarc: "M62",
  },
  {
    code: "CO-4",
    group: "CO",
    reason: "4",
    meaning: "The procedure code is inconsistent with the modifier used, or a required modifier is missing.",
    carcClass: "denial",
    nextAction: "Correct the modifier and resubmit. Do not invent a modifier in this product.",
    demoRarc: "N519",
  },
  {
    code: "PR-1",
    group: "PR",
    reason: "1",
    meaning: "Deductible amount.",
    carcClass: "patient-responsibility",
    nextAction: "Post the amount to patient responsibility. Do not open an appeal.",
    demoRarc: "",
  },
  {
    code: "OA-23",
    group: "OA",
    reason: "23",
    meaning: "The impact of prior payer adjudication, including payments and adjustments.",
    carcClass: "informational",
    nextAction: "Confirm the prior payer adjudication. Do not work this as a denial.",
    demoRarc: "N4",
  },
];

export function carcRule(code: string): CarcRule | undefined {
  return CARC_RULES.find((rule) => rule.code === code);
}

export function isAppealableDenial(code: string): boolean {
  return carcRule(code)?.carcClass === "denial";
}
