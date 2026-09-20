# LR-PX-C return — Speed to lead, follow-up automation, the Sources report, and bulk actions

TASK: LR-PX-C / attempt 1 / packet rev 1
STATUS: **submitted** (not self-accepted)

---

## WHAT THIS WORKSTREAM IS FOR

One owner, four complaints, in his words:

- He answers a website lead a day late, because nothing tells him one arrived and nothing chases him.
- He forgets to follow up on a quote he sent, because a sent quote is a document and not a task.
- He does not know which lead source pays. He knows how many leads each one sent, which is not the
  same question.
- He edits records one at a time. Retagging eleven customers is eleven page loads.

Evidence of the gap, as of the 2026-09-20 grep of the tree at `b8958aa`: no automation or rule code
of any kind; `reports.leadsBySource` counts deals and value per source but has no won count, no won
value, no win rate and no time-to-win; no list screen has a selection model, and the only occurrence
of the word "bulk" in `src/features/records` is a comment in `ContactsScreen.tsx` about how an em
dash reads "at 40px rows scanned in bulk".

The workarounds avoided: remembering, a separate task app, and a spreadsheet of lead sources kept by
hand.

---

## CANDIDATES CONSIDERED

| candidate | verdict | reason |
| --- | --- | --- |
| Three fixed automation rules (lead arrived, quote sent, invoice overdue) switchable in Settings | **build now** | Each one closes a named, recurring failure the owner described, and each is a task the product already knows how to show on Today, Tasks and Schedule. Fixed in kind rather than a rule builder: a builder is a product, this is a switch. |
| Per-stage follow-up rules ("after N days here, remind me to …") | **build now** | The owner's pipeline already encodes his process; the stage is the natural place to hang "and then chase it". It costs two nullable columns and reuses the same runner. |
| Leads-by-source report with won, won value, win rate and median days to win | **build now** | The data is already in the database and the product already asks for the source on every record. Without the money side of it the existing source card answers the wrong question. |
| Bulk actions with a real selection model, on Contacts and the deals list | **build now** | Pure recurring effort, no new data model, and the transaction and undo machinery it needs already exists. |
| A general rule builder (if/then, any trigger, any action) | **reject** | Unvalidated demand and a permanent maintenance surface. Three switches answer the complaints that were actually made; a builder answers a complaint nobody made and has to be supported forever. |
| Sending the follow-up email or text itself | **reject** | Helix never sends. That is a product promise (decision PX-3), not a missing feature. |
| A background scheduler or job queue for automations | **reject** | Decision PX-4 is binding and correct for a single-user desktop app: a rule runs inside the write that triggered it. The one thing that genuinely has no triggering write — an invoice going overdue with nobody touching it — is a small idempotent sweep on boot, not a scheduler. |
| Bulk edit of arbitrary fields ("set any field on any selection") | **later** | The four actions per list cover what the owner named. An arbitrary field editor needs a per-field validation and undo story that no one has asked for yet. |
| Multi-select on the pipeline board | **judged in place** | See DEVIATIONS: taken only if it does not compromise drag-and-drop. |

---

## PROPOSED TEXT for `docs/CONTRACTS.md` (Fable integrates)

### Automations (LR-PX-C, binding)

Helix has no job queue and no background scheduler. An automation runs **synchronously inside the
transaction of the write that triggered it** (coordinator decision PX-4) and produces an **ordinary
task** — it appears on Today, Tasks and Schedule exactly like one the owner typed, and is told apart
only by `tasks.source = 'automation'`.

**The rules.** Three are fixed in kind and switchable, one row each in `automations`:

| `kind` | trigger | default |
| --- | --- | --- |
| `lead_arrived` | a website lead becomes a deal, inside `applyLeadPage`'s per-page transaction | on, 60 minutes, "Call {name} about their request" |
| `quote_sent` | a quote's status becomes `sent`, through `documents.onDocumentStatusChanged` | on, 3 days, "Follow up on quote {number} with {name}" |
| `invoice_overdue` | the boot sweep finds a `sent` or `partial` invoice past its due date | off, 3 days, "Invoice {number} is overdue: check in with {name}" |

A fourth kind of rule belongs to a **stage** rather than to the table: `stages.follow_up_days` and
`stages.follow_up_title` (both nullable, `drizzle/0008_automations.sql`) mean "when a job enters this
stage, remind me to … in N days". It fires from `deals.moveToStage`, on a real stage change only.

**Title templates.** `{name}` the customer, `{number}` the quote or invoice number, `{job}` the job's
title. An unknown token is left alone; a token with no value renders as nothing.

**Delays** are stored in `automations.delay_minutes` in every case. The Settings screen shows the unit
the rule is actually thought about in — minutes for speed to lead, days for the other two — and
converts.

**Firing exactly once** is guaranteed by `automation_runs (kind, subject_id)` with a unique index,
not by inspecting tasks. The marker has to survive the owner deleting the task the rule created — a
deleted reminder must not come back — and it must not depend on the rendered title, which the owner
can rewrite at any time. Subject ids: the deal id for `lead_arrived`, the document id for
`quote_sent`, `<dealId>:<stageId>:<YYYY-MM-DD>` for a stage rule (so a genuine re-entry next month
reminds again, and a double-move today does not), and `<documentId>:<YYYY-MM-DD>` for
`invoice_overdue` (once per invoice per day).

**The runners never take the write lock.** `runLeadArrived`, `runQuoteSent`, `runStageEntered` and
`runInvoiceOverdue` each assume the caller is already inside `withWrite`/`withTransaction`; they read,
then return `{ statements, taskId }` for the caller to batch. The lock is not reentrant, so a runner
that wrote for itself would deadlock its own caller. `automationSweep()` is the one exception: it has
no caller's transaction, so it opens its own.

**Every automation leaves a timeline entry** on the record, in the same transaction, saying what Helix
did and why — "Helix added a follow-up: Call Dana Reyes about their request. Due in 1 hour, because a
new lead arrived." A task linked to no record writes no entry, because there is no timeline for it to
appear on.

**Where the rules are registered.** `src/features/settings/lib/automationBoot.ts`'s
`startAutomations()`, called from the settings feature's `onBoot`. It registers the document-status
listener and runs the sweep once, and a failure in either is logged and swallowed — a rule must never
be able to stop the app from starting.

### The bulk stage move (LR-PX-C, binding)

`deals.moveManyToStage(ids, toStageId, options) → { moved, batchId }` is ONE transaction sharing ONE
`change_log` batch id, so Cmd+Z reverses the whole move. It shares its body with `moveToStage`
(`applyStageMove`), so a bulk move is the single move repeated: same validation, same
`deal_stage_events` row, same timeline line, same follow-up task, once per deal. A deal already in the
target stage is not a move and fires nothing. A deal that fails validation — a lost stage with no
reason — takes every other deal in the call back with it.

`stages.remove(id, moveToStageId)` deliberately still moves its orphaned deals with raw SQL and fires
no stage rules: deleting a stage is bookkeeping, not twelve jobs entering a stage, and it must not
produce a reminder per deal.

### The selection model (LR-PX-C, binding)

`src/lib/selection.ts` is pure and framework-free: a `SelectionState` of ids plus an anchor, with
`toggle`, `selectOnly`, `selectRange` (the inclusive run between the anchor and the clicked row in the
list's current order), `selectAll`, `clear` and `reconcile`. Selection is keyed by **id, never by row
index**, which is what lets a `VirtualList` scroll without disturbing it; `reconcile` drops ids that a
refilter removed, so a bulk action can never act on a row the owner can no longer see. `src/ui/BulkBar.tsx`
renders nothing at a count of zero and carries no primary button — the screen has already spent its one
primary block. Escape clears the selection on every screen that has one.

---

## PROPOSED TEXT for Help (`src/features/help/lib/content.ts`)

`HELP_SECTIONS` is held to exactly six by `tests/unit/help/content.test.ts`, so this follows the
precedent `HELP_INVOICES` and `HELP_TROUBLE` already set: a separate export rendered after
"Working a job from lead to won", not a seventh entry in the array.

```ts
export const HELP_AUTOMATIONS: HelpSection = {
  id: "follow-ups",
  title: "Letting Helix chase the follow-up",
  paragraphs: [
    "Helix can write the follow-up for you rather than leaving you to remember it. Open Settings, then Automations, and you will find three switches: one that puts a call on your list an hour after a website lead arrives, one that reminds you three days after you send a quote, and one, off until you turn it on, for an invoice that has gone past its due date. Each one has the wording of the reminder beside it, so you can make it say what you would have written.",
    "You can write your own into the wording with {name} for the customer, {number} for the quote or invoice, and {job} for the job itself. Whatever a rule creates is an ordinary task: it shows up on Today and on your schedule, you tick it off the same way, and the customer's history says what Helix added and why.",
    "Your pipeline can chase a job too. Open the pipeline, press Manage stages, and give a stage a follow-up: after two days in Quoted, remind me to ring them. Every job that moves into that stage gets that reminder once, whether you dragged it there or moved twelve at a time.",
  ],
};
```

Two sentences to fold into sections that already exist:

- **"Your website's leads"**, replacing the last sentence of the second paragraph: "The Sources report
  shows not just how many leads each source sent but how many you won, what they were worth and how
  long they took, so you can see which one pays instead of which one is loudest."
- **"Getting your customers in"**, appended: "On the Contacts and Pipeline lists you can tick a run of
  rows — click the first, hold shift and click the last — and then tag them, set their company, move
  them to a stage or send them to the Trash all at once; it happens in one step and one Undo takes it
  all back."

---

## PER FEATURE

### 1. Speed-to-lead and follow-up automation

**User and problem.** The owner answers a website lead a day late and forgets to follow up on a quote
he sent. Nothing in Helix chased him.

**Evidence.** No automation or rule code existed anywhere in the tree at `b8958aa`.

**Workaround avoided.** Remembering, or a second task app beside the CRM.

**Smallest complete version, shipped.** `drizzle/0008_automations.sql` adds two nullable `stages`
columns, the `automations` switchboard seeded with the three rules, and the `automation_runs`
idempotency ledger. `src/db/repos/automations.ts` holds the runners; they fire from the three real
write paths — `applyLeadPage`, `documents.onDocumentStatusChanged`, and `deals.moveToStage` — each
inside the triggering transaction, plus a boot sweep for the one trigger that has no write behind it.
Every rule produces an ordinary task with `source: 'automation'` and a timeline line saying what Helix
did and why.

| acceptance | result | evidence |
| --- | --- | --- |
| C-1 rules fire once, only when enabled, with timeline activities | **pass** | `tests/repo/automations/{rules,runners,invoiceOverdue}.test.ts`; `tests/repo/leads/leadArrivedRule.test.ts` (6 tests: fires, timeline entry, re-poll writes no second task, one per lead on a page, disabled writes nothing, rewritten title and delay honoured); `tests/repo/dealsStageRule.test.ts` (stage rule fires on entry, not for a stage with no rule, not when the deal is already in that stage) |
| C-2 Settings edits persist, vocabulary respected | **pass** | `tests/unit/settings/automationsScreen.test.ts`; `px-c-automation.e2e.ts` |

### 2. The leads-by-source report

**User and problem.** He does not know which lead source pays. The existing source card counted leads
and value, which is a different question from "which one do I win, and for how much".

**Evidence.** `reports.leadsBySource` had deal count, value, won count and open count — no won value, no
win rate, no time to win — and no screen of its own.

**Smallest complete version, shipped.** `src/db/repos/sourceReport.ts`'s `sourcePerformance(period)`
over the existing `v_report_deal_sources` view joined to `deals` for `closed_at`, and
`/reports/sources` as a sixth report tab with a period picker, CSV export and an empty state.

| acceptance | result | evidence |
| --- | --- | --- |
| C-3 correct against fixtures and exported | **pass** | `tests/repo/reports/sourceReport.test.ts`, `tests/unit/leads/sourcesReport.test.ts`, and the Sources tab tests in `leads.e2e.ts` |

### 3. Bulk actions

**User and problem.** He edits records one at a time.

**Evidence.** No list screen had a selection model; the only occurrence of "bulk" in
`src/features/records` was a comment about how an em dash reads in a scanned list.

**Smallest complete version, shipped.** `src/lib/selection.ts` (pure, id-keyed), `src/ui/BulkBar.tsx`,
`src/db/repos/bulk.ts` and `deals.moveManyToStage`, wired into the Contacts list and the deals list.

| acceptance | result | evidence |
| --- | --- | --- |
| C-4 transactional with a single undo | **pass** | `tests/repo/bulk.test.ts` (rollback proven for five actions, undo proven for five including the remove-tag case added with the fix below); `tests/repo/dealsStageRule.test.ts` (`moveManyToStage` one batch id, rule once per deal, whole-move rollback, one-step undo); `px-c-bulk.e2e.ts` |
| C-5 no colour literals, no native inputs, one primary block | **pass** | grep of every new and changed view for `#hex`/`rgb`/`hsl`, `type="date"`/`type="time"`, `rounded`, `shadow-*`: all clean. The second `variant="primary"` on Contacts and the deals list is a dialog confirm, which is its own surface and the pattern the deals list already used. |

## VERIFICATION

Run by me against the assembled workstream at `65f22bc`, not by a worker:

| check | command | result |
| --- | --- | --- |
| typecheck | `npm run typecheck` | clean, no output |
| whole suite | `npx vitest run` | **217 files passed, 1 skipped; 2706 tests passed, 3 skipped**, 120s |
| build | `npm run build` | clean, built in 1.90s |
| e2e | `E2E_PORT=4322 E2E_OUT=dist-pxc npm run e2e:mac -- px-c-automation.e2e.ts px-c-bulk.e2e.ts leads.e2e.ts records.e2e.ts settings.e2e.ts` | **67 passed**, 3.0m |

`dist-pxc`, `dist-pxc-auto` and `dist-pxc-bulk` removed; ports 4320–4329 clear; nothing running.
(`dist-pxa` remains and is Lead A's.)

**Mutation checks.** Three guards were confirmed to actually refuse, not merely to be present:
`automations.update` rejecting a bad delay and an empty title (`rules.test.ts`); `moveManyToStage`
taking every deal back when one move fails validation (`dealsStageRule.test.ts`); and the remove-tag
undo test, which was written against the broken behaviour first and observed to fail before the fix.

## DEVIATIONS

1. **No multi-select on the pipeline board — accepted.** W3 argued the card is simultaneously the drag
   source and the open target, Shift+Arrow already means "move this card", and the board's optimistic
   column rewrite during a drag would race a selection reconcile. I inspected the file and agree: the
   board's value is the drag, and a selection model would put three meanings on one gesture. The deals
   **list** carries the full bulk bar, which is the surface a twelve-row edit belongs on anyway.
2. **The idempotency marker is a new `automation_runs` table, not a column on `tasks`.** This removes
   the dependency on Lead B that the brief anticipated. A marker on `tasks` would be destroyed by a
   purge and would depend on the rendered title, which the owner can rewrite — so a deleted reminder
   could return and a renamed one could double-fire.
3. **`sourcePerformance` lives in a new `src/db/repos/sourceReport.ts`, not in `reports.ts`**, because
   Lead A was writing in `reports.ts` this round and the rule is one active writer per file. Folding it
   into `reports.ts` later is a pure move.
4. **The three automation-rule seeds use `INSERT ... SELECT ... WHERE NOT EXISTS`**, not
   `INSERT OR IGNORE`: the latter does not match the statement shape `tests/repo/migrations.test.ts`
   enforces. Equally idempotent, and the form `0006_payments.sql` already uses.
5. **Empty title with days set is refused with a message** in the stage manager, rather than silently
   clearing the days.
6. **A worker briefly launched a sub-subagent**, against the no-further-delegation rule in its packet.
   It stopped itself, discarded the output, and reported it unprompted. No work product came from it;
   recorded here because the protocol says to.
7. **`prettier --write` was run once on `deals.ts` and reverted.** This repo has no prettier config or
   script, so the default 80-column setting reformatted unrelated lines. The edits were redone by hand.

## FINDINGS FOR OTHER OWNERS

1. **Lead A — `sampleData.ts` cannot remove the example any more.**
   `src/features/onboarding/lib/sampleData.ts:640` runs `DELETE FROM documents WHERE deal_id IN (…)`,
   and `payments.document_id` references `documents` with `onDelete: "restrict"`. The sample
   landscaping set contains one paid invoice, which now always has a payment row behind it, so the
   delete is refused. Isolated proof: deleting the sample deal succeeds, deleting the sample document
   raises `FOREIGN KEY constraint failed`. It failed 5 tests in `tests/repo/onboarding/`. Green again
   as of the run above, so Lead A appears to have fixed it; recorded because it was diagnosed here and
   the diagnosis may be useful if it recurs.
2. **`tags.setTags` has the silent-undo hole this round fixed in `bulk.ts`.** It logs a hard delete of
   a `tag_links` row with a `before` that carries no `id`, so `changeLog.undoBatch` takes its
   soft-delete branch and emits an `UPDATE … WHERE id = ?` that matches nothing. Undo reports success
   and restores no tag. Outside this round's ownership, so it is reported rather than changed. Worth a
   small ticket: the fix is to log the whole row.
3. **Fable — the e2e capture specs rewrite `design/round3/*.png`.** Running `records.e2e.ts` and
   `leads.e2e.ts` regenerates the reference screenshots, and `reports-sources-{light,dark}.png` are new
   from the Sources screen. I left every one of them uncommitted rather than commit another owner's
   regenerated artifacts; they are yours or the design agent's to take.
4. **Fable — `HELP_SECTIONS` is held to exactly six** by `tests/unit/help/content.test.ts`, so the
   proposed `HELP_AUTOMATIONS` above is a separate export following the `HELP_INVOICES` precedent
   rather than a seventh array entry.

## ESCALATIONS

None outstanding. The two the brief anticipated both resolved without Walker: the `tasks` column from
Lead B was designed out, and Lead A's document-status hook had landed before it was needed.

## HANDOFF

- Commits, in order: `b39c0d9` (W1, data layer), `05f5161` (me, the call sites and the bulk stage
  move), `1d15b27` (W3, selection and bulk actions), `ec9f2b3` (W2, Settings and the Sources report),
  `65f22bc` (me, the undo fix and the e2e scoping). Local only; nothing pushed.
- `src/db/schema.ts` and `drizzle/meta/_journal.json` carry this workstream's tables and journal entry
  idx 8, but were committed inside Lead A's `ccc40e3` — that commit swept up the uncommitted edits
  sitting in the shared files. Verified verbatim against `git show HEAD:`. Nothing is lost and nothing
  is left to commit there, but `drizzle/meta` still has no snapshot for 0006, 0007 or 0008, which you
  said you would reconcile.
- Nothing running, no dist of mine left, tree clean apart from the design screenshots and the other
  leads' own return files.
