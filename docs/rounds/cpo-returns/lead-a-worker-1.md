# Lead A's Sonnet worker W1 (undo, search, views, tasks, reminders) return, relayed by Fable

TASK: CPO-LA-AUDIT-W1 / attempt 1 / rev 1. STATUS: submitted. Spec: tests/e2e-mac/specs/laAuditWorker.e2e.ts (5 tests, all green, port 4233, dist-la-3 deleted). Screenshots under tests/e2e-mac/.cache/screens/la/ (s10..s14).

## Findings
- F-W1-1 · high · defect · Today buckets overdue on due_on only (tasks.ts:177-191) while Tasks screen and deal rail use isOverdue (dates.ts:70-90 via taskGroups.ts:38, TaskRow.tsx:21,42). Same as Lead A's F-LA-8. Fix: tasks.today() uses the shared isOverdue. S.
- F-W1-2 · medium · usability · a saved view whose filter tag was deleted shows the generic "Nothing matches" (hooks.ts:156-173 useEntityTagIndex live tags; tags.softDelete leaves tag_links). Fix: name the missing tag with Edit/Delete view. S-M.
- F-W1-3 · low · defect · search results stale up to 10 s after out-of-band writes (SearchDialog.tsx:99-111 staleTime 10_000; nothing invalidates qk.search; invalidateRecords() omits it). Fix: invalidate qk.search (and recent) in invalidateRecords or drop staleTime. S.
- F-W1-4 · low · usability · a task on a soft-deleted deal loses its deal chip silently (TasksScreen dealLabels from useDeals excludes deleted); Recurring's WhoCell shows "No record attached". Fix: "job deleted" note. S.

## Scenarios
- S10 undo/redo/persistence: fine for inline edit, stage move, soft delete (contact, task), quick add; change_log matches CONTRACTS; no ghost stage events. Not asserted: duplicate activity rows on task-delete undo/redo.
- S11 search: phone with punctuation found; note body found; deleted excluded; restore re-indexes but F-W1-3 stale cache. Result types: contacts, companies, deals, notes; no tasks or invoices.
- S12 saved views: filter+sort round-trip, deep link, pin all fine; F-W1-2 on deleted tag.
- S13 tasks: timed before untimed same day fine; F-W1-1; F-W1-4; Show done fine (1000-row cap, no pagination UI, code reading).
- S14 recurring: fine throughout (3-month advance correct, skip leaves last_completed_on, deleted contact handled honestly).

## Verification
tsc clean (src only); playwright 5 passed. No product file touched. No contract/schema change needed.
