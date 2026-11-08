---
id: phi-policy
tags: [phi, privacy, synthetic, ssn, mrn]
status: demo
---

# Synthetic patients only

Allowed identifiers are `PAT-###`, `CLM-###`, and `DOC-###`.

Intake briefs, diffs, seed data, and everything a run stores before it is recorded are scanned for:

- a social security number shaped `###-##-####`
- an email address
- a phone number
- a raw `MRN` followed by an identifier
- a date labelled as a date of birth (`DOB`, `date of birth`, `birthdate`)

A hit blocks the run before a requirement document is written. This is a demo scanner. It is not a HIPAA determination, and the project does not offer a business associate agreement.
