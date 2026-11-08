---
id: glossary
tags: [glossary, 837, 835, carc, rarc, era, npi, pos, dos, ar]
status: demo
---

# Glossary for this demo

These words mean only what Northwind Imaging's demo uses. They are not a full X12 implementation guide.

- **837P** — the professional claim shape. This demo does not emit an 837. It shows the claim lines that would have been on one.
- **835 / ERA** — the remittance that carries adjustment group, CARC, and RARC. The demo loads a fixture, not a clearinghouse file.
- **CARC** — claim adjustment reason code. The demo table is six codes.
- **RARC** — remittance advice remark code. On a real remit the remark that arrived is the one that counts. The fixture pairs one remark with each demo CARC.
- **NPI** — billing provider id. Northwind's fixture NPI is `1999999999` and is not a live provider.
- **POS** — place of service. Outpatient imaging in this demo uses POS `11` and `22` as labels only.
- **Date of service** — the day the study was performed. Timely filing is counted from this date.
- **A/R** — open receivable. The lead summary counts denials. It does not compute net collection rate.
