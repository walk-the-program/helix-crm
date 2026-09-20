# Lead A (records audit) return block, relayed by Fable (main session)

TASK: CPO-LA-AUDIT / attempt 1 / packet revision 1. STATUS: submitted.

SUMMARY: repository layer disagrees with itself in four places: quick add duplicates on double Enter; pipeline headline counts closed deals as open; a contact changing company leaves deals/documents behind; "overdue" has three definitions. All eight seed findings confirmed (seed-5's fix insufficient: moveToStage ignores a new date when the stage does not change). quotedCents has one consumer: MoneyStrip.tsx:91. Biggest gap: contact page never shows the contact's jobs; first-run screen collapses into six empty panels after the first contact.

## Findings (id · severity · kind · one line · owner/size)
- F-LA-1 · critical · defect · quick add creates two records on double Enter (QuickAddDialog.tsx:159, :266-274; save() not guarded). Fix: useRef in-flight guard checked by keydown and both buttons. S · Sonnet.
- F-LA-2 · high · defect · pipeline headline counts/totals closed deals ("10 open · Upfront $108,280" vs 7 open $103,930); "Upfront" shown when one_time_cents=0 everywhere (PipelineScreen.tsx:121-131,163; deals.board no openOnly). Fix: total non-won/lost columns; label "7 open · $103,930", add "· $150/mo" only when recurring exists. S · lead.
- F-LA-3 · high · defect · deal MoneyStrip reads money.quotedCents (only consumer MoneyStrip.tsx:91) so a won $1,450 deal shows Quoted $0…; after Quoted=value_cents fix, label the block "Won" on won deals. S · lead, blocked on money.ts.
- F-LA-4 · high · defect · contact company change (contacts.ts:418-439) does not move open deals/documents; old company page still counts them. Fix: confirm "Move her 2 open jobs too?" default yes, one undo batch, via deals.update so syncCustomerFromDeal fires; closed deals stay. M · lead.
- F-LA-5 · high · usability · ContactPage.tsx shows no deals; mount the CompanyPage DealsCard pair above Details. S · Sonnet.
- F-LA-6 · high · usability · Today flips to six empty panels after the first contact (TodayScreen.tsx:206,237-241 uses workspace-wide emptiness); quick add finish() never navigates. Fix: navigate to the created record; keep starter cards until something is on Today (task/deal/activity); "Gone quiet" must not claim deals are moving when none exist. M · lead.
- F-LA-7 · high · usability · Contacts/Companies lists carry no phone, email, next step (ContactsScreen.tsx:388-406, 472-510; Contact type lacks phone). Columns: Contacts Name · Phone (one-tap call) · Next step · Tags; Companies Name · Phone · Open jobs · Tags; breakpoints 1440/1280/1024; new subqueries in contacts.ts/companies.ts; sort ids opaque so saved views survive. L · lead + Sonnet.
- F-LA-8 · medium · defect · "overdue" three ways (tasks.ts:187 dueOn only; lib/dates.ts isOverdue via taskGroups; TaskRow). Fix: tasks.today() partitions with the shared isOverdue. S · Sonnet.
- F-LA-9 · medium · defect · trashed company still named unmarked on lists/board/deal page (joins lack deleted_at IS NULL in contacts.ts:164, deals.ts:163-166, search.ts). Fix: append "(in Trash)" wherever rendered; deals need company deleted_at in DEAL_COLS. M · Sonnet.
- F-LA-10 · medium · defect · wrong won date cannot be corrected; deals.ts:562-568 ignores at when stage unchanged. Fix: explicit at wins for closedAt; timeline line "Won date changed to …"; "Won on/Lost on" row opens StageMoveDialog prefilled. M · lead. ESCALATION: changes moveToStage semantics read by reports.
- F-LA-11 · medium · defect · Reopen (DealPage.tsx:181-186) has no undo, lands in first open stage silently, never recompute → recurring clock keeps running. Fix: writeWithUndo + recompute + confirm defaulting to the pre-close stage from deal_stage_events. M · lead. Confirm recompute clears recurring_started_on (money owner).
- F-LA-12 · medium · usability · board card "No company" for a deal with a person (DealCard.tsx:95). Fix: contact name, else company, else "No customer"; add contact name to DEAL_COLS. S · Sonnet.
- F-LA-13 · medium · defect · "1 open jobs" (CompanyPage.tsx:117-119); singularise with vocabulary.one. S · Sonnet.
- F-LA-14 · medium · usability · customer strip shows Won/Invoiced/Collected only; add Open (value of open deals) first. Needs a MoneyTotals field from money.ts. S · lead, blocked. ESCALATION.
- F-LA-15 · low · defect · snooze clears due_at (tasks.ts:325-342); shift the time by days instead. S · Sonnet.
- F-LA-16 · low · usability · two ways to add a task; placeholder reads like a real task (TaskComposer.tsx:80). Drop header button; placeholder "What do you need to do?". S · Sonnet.
- F-LA-17 · low · usability · four copy/honesty items: Trash empty state "Back to Contacts" button; DealPage expected date shown twice; permanent drag hint above the board; not-found copy asserts deletion. S · Sonnet.
- F-LA-18 · low · hypothesis · deal in a deleted stage vanishes from the board while counted in the header (PipelineBoard columns from stages.list; deals.board's orphan entry dropped; CONTRACTS promises a column). Recommend rendering an "Unassigned stage" column. S · lead after contract ruling. ESCALATION: CONTRACTS.md wording.

## Scenarios: 1 (F-LA-6), 2 fine on code path (not walked; F-LA-15), 3 (F-LA-1, F-LA-2), 4 (F-LA-4), 5 (F-LA-9), 6 fine for v1 (no stakeholder table; proportionate), 7 NOT CHECKED (merge), 8 fine except F-LA-11, 9 fine except F-LA-10, 10-14 delegated to a Sonnet worker still running (spec tests/e2e-mac/specs/laAuditWorker.e2e.ts, port 4233, dist-la-3), 15 fine, 16 NOT ANSWERED (long-names harness test timed out twice), 17 fine, 18 fine for not-found routes; F-LA-18 for orphan stage.

## Verification actually run
- laAudit.e2e.ts on 4231 (1 passed, 2 failed on vocabulary-named tab selector), fixed selector and re-ran on 4232 (dense scenario passed; long-names timed out). dist folders deleted. No product file touched; only tests/e2e-mac/specs/laAudit.e2e.ts added (uncommitted) and evidence under tests/e2e-mac/.cache/screens/la/ (la-notes.json + 14 screenshots). typecheck/vitest/build NOT run (no product code changed).

## Contract changes to route
- MoneyTotals needs an open-deal figure (money.ts owner).
- deals.moveToStage: explicit at overrides closed_at (reports read closed_at; owner to acknowledge).
- CONTRACTS.md deals.board() paragraph vs the board (F-LA-18).
- Reopen must call dealItems.recompute; confirm it clears recurring_started_on.
- No schema change needed.

## Suggested order
F-LA-1, then F-LA-4 and F-LA-2, then F-LA-5 and F-LA-6, then F-LA-3 after money.ts, then the small worker batch.

## Handoff
One Sonnet worker (scenarios 10-14) still running; writes only laAuditWorker.e2e.ts and the la/ screens; port 4233, dist-la-3. Budget exceeded (two long harness runs).
