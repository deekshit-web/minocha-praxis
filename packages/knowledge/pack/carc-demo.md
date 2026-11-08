---
id: carc-demo
tags: [carc, denial, co-16, co-50, co-197, co-4, pr-1, oa-23, remittance]
status: demo
---

# Demo CARC table

Meanings follow the public X12 claim-adjustment reason descriptions, shortened for the booth. The remark codes are Northwind fixture pairings. Confirm both lists against the current X12 external code list before any production use. An unknown code stays `unmapped`. The product must not invent a meaning.

| Code | Class | Meaning | Only allowed next action | Fixture remark |
| --- | --- | --- | --- | --- |
| CO-16 | denial | Claim/service lacks information or has a submission or billing error. | Correct the missing element named by the remark and resubmit the claim. | MA130 |
| CO-50 | denial | These are non-covered services because this is not deemed a medical necessity by the payer. | Appeal with the coverage policy and a clinical-note reference. Do not change the diagnosis code in this product. | N115 |
| CO-197 | denial | Precertification, authorization, or notification is absent. | Attach the authorization reference if one exists. Otherwise route to the authorization desk for a retro request. | M62 |
| CO-4 | denial | The procedure code is inconsistent with the modifier used, or a required modifier is missing. | Correct the modifier and resubmit. Do not invent a modifier in this product. | N519 |
| PR-1 | patient-responsibility | Deductible amount. | Post the amount to patient responsibility. Do not open an appeal. | |
| OA-23 | informational | The impact of prior payer adjudication, including payments and adjustments. | Confirm the prior payer adjudication. Do not work this as a denial. | N4 |

CO-50 is a payer coverage decision recorded on the remit. This product does not decide medical necessity and does not recommend a different diagnosis.
