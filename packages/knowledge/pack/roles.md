---
id: roles
tags: [roles, denial-specialist, pfs, front-desk, coder, biller]
status: demo
---

# Roles

- **Front desk** may read eligibility and must not schedule when coverage is inactive. They do not work denials.
- **Coder** owns modifiers and diagnosis pointers. This product does not suggest CPT or ICD changes.
- **Biller** resubmits corrected claims, including CO-16 and CO-4.
- **Denial specialist** works appealable denials. They may mark a CO-50 packet ready only when the gate is satisfied. They cannot override the gate in v1.
- **PFS lead** sees counts by CARC class. They do not mark packets ready.

Nobody in this demo may write off a balance or change a diagnosis code.
