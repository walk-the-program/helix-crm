# Lead B (money) PHASE-TWO return (received directly by the coordinator, 02:5x)

TASK: CDQO-LB / attempt 1 / packet rev 1 + addendum. STATUS: submitted.

## Design findings (implemented unless stated)
Reports (W1, landed as 30e1dba): D1 a zero in a period table is an em dash (DataTable →
kit moneyOrDash + TD dashZero; headlines keep $0.00); D2 caption to two lines; D3 one
headline system; D4 per-deal table gains Copy as CSV (phase one had not done it); D5 six
columns clipped at 1024 with no cue, fixed at DataTable level; D6 Customer column
truncation + title; D7 quiet EmptyState for section empties. D8 DEFERRED: Receivables'
aging buckets are a card of rows, not a semantic table (AgingBlock.tsx) — sent back as a
follow-up. Invoices (W2, b7aaf17): D20 field order; D21 closed by the lead (18114d0);
D22 empty-state vocabulary; D23 sub-rows; D24 Tax column hides unless taxability is
mixed (reuses the PDF's hasMixedTaxability); D25 Number column at 1024; D26 label prop.
Lead: Document page (d841146: Send reappeared on paid invoices — own phase-one
regression; Void and Delete both on a draft; "Due in 14 days" on a paid invoice;
"Paid · bank"; two permanent instructions); poll schedule as a caption (0d3d739);
Services counts jobs (f745b7b); repositories speak the workspace's word (8c4cae4);
label prop (eed6b60). F-P2-LB-1 (2eaa0ff): invalidateDealMoney never invalidated
["money"]; pinned by a no-reload test.

## Chunk split (measured after each change)
Baseline 2,924.62 kB / 849.62 kB gzip → recharts lazy 1,988.89 → the three static
re-exports in the feature index removed (they would have pulled the screens back into
the main chunk with the build still green) 1,941.69 → pdf-lib at the call site
1,355.06 kB / 357.57 kB. 54% smaller raw, 58% gzipped; nothing on the boot path lazy.

## Verification (committed state)
typecheck clean; vitest 2094 passed / 3 skipped; invoices+revenue+leads e2e 40 + 23
green including the Today, PDF and lazy-report paths; vite build green;
revenue.e2e.ts:314 uses /^Move to /; PDF re-reviewed after all changes (three samples).

## Deviations
W1 finished without committing (landed by the lead with attribution after re-running its
checks); W1 verified only its own spec and broke a leads.e2e.ts assertion (caught and
fixed); W1 rightly refused to delete formatMoneyOrDash (dashes NULL; the kit dashes
ZERO) — renamed; no before-screenshots from W1 (cited the cpo/* set). ImportScreen's
breadcrumb arrow is 16 where five other screens use 14 (lead-platform's).

## Handoff
Design specs deleted; durable assertions moved; nothing dirty; ports free.
