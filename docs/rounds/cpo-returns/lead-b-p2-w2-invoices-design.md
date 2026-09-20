# Lead B phase-two worker W2 (invoices design pass) return, relayed by Fable

TASK: CDQO-LB-W2 / attempt 1 / rev 1. STATUS: submitted. Commit b7aaf17.

Findings: F-LB-D20 New invoice field order (Contact/Company → Job → Kind+dates; implemented); F-LB-D21 Job field labels hardcoded, not vocabulary-driven (DEFERRED: invoices.e2e.ts outside its ownership matches "Job"/"New job" verbatim; route to the spec owner); F-LB-D22 empty-state copy said "deal/job" unconditionally (implemented via vocabulary); F-LB-D23 description/detail sub-rows (implemented: detail borderless, muted); F-LB-D24 read-only Tax column hidden when no mixed taxability on locked docs (implemented; test documentLines.test.tsx); F-LB-D25 Number column truncated at 1024 (implemented); F-LB-D26 ariaLabel → aria-label migration in four files (implemented). Kit-level table last-row hairline already solved (8d4d5e1).
Checks: list, new invoice (validation only on submit), dialogs (hoisted footers, deposit split updates live), copy: verified with screenshots p2w2-* under tests/e2e-mac/.cache/screens/lb/.
Verification: typecheck clean; unit/repo invoices 155 passed; build ok; invoices.e2e 15/15 twice; lbDesignInvoices.e2e 2/2 (spec to be deleted by Lead B at the end).
Handoff: nothing running; dist removed.
