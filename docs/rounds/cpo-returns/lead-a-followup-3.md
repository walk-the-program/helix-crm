# Lead A follow-up (CPO-LA-3, packet rev 3) return, relayed by Fable

STATUS: submitted. Commits ab4a665 (merged-away records) and 13d4ed3 (CompanyPage adopts shared DealsCard), both on main.

(a) trash.mergedInto(entityType, id) reads the merges table (reversed merges return null); contact/company pages and Trash rows show "Merged into <survivor>" linked, a Merged badge, and no Restore; plain deletions keep Restore. useMergedInto runs only for deleted records.
(b) CompanyPage local DealsCard removed (−47/+21), same merge treatment applied.
(c) laAudit specs confirmed gone (never committed).

Acceptance 1-6 pass (repo tests tests/repo/trashMerged.test.ts 5; e2e in records.e2e.ts "a merged-away contact names its survivor and offers no Restore").
Verification: typecheck clean repo-wide; 26 files / 271 tests in its area; records+today e2e 31 passed on 4231; build folders removed.
Deviations: mergedInto lives in trash.ts (one query, not two); chained merges follow the chain; merge notice is a link in the badge row.
Handoff: nothing running; earlier open items closed (MoneyStrip currency ae02923; duplicate DealsCard gone).
