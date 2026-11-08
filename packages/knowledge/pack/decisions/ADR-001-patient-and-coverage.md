---
id: adr-001
tags: [decision, patient, coverage, eligibility, feature-a]
status: demo
---

# ADR-001 Patient and coverage

Feature A's denial workbench identifies people only with `PAT-###` and claims only with `CLM-###`. Coverage is a separate snapshot: status `active` or `inactive`, and a copay in cents. Eligibility (Feature C) must cite this note and reuse those identifiers. It must not introduce a second patient key.
