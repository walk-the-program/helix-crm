# LR-PX-A return — payments as records, balances, and a customer statement

TASK: LR-PX-A / attempt 1 / packet rev 1. Parent: Fable. Base: main at `b8958aa`.
Lead: Opus A (Chief Product Expansion Officer, workstream A). Workers: three Sonnet
(W1 data and reports, W2 interface, W3 PDF, statement, export and report screens).

STATUS: submitted. Thirteen commits on main, `871de82`..`4f314fe`. All eight acceptance
criteria pass. Three escalations and six deviations below, none blocking.

## The feature, and why it belongs in this CRM

**The user and the problem.** A solo trade owner takes a deposit before the job and the
balance after. He is paid in cash, by check, by card and by transfer, sometimes two of
those on one job. Two questions run his week: *what does this customer still owe me*, and
*what came in this month*. Neither could be answered in Helix.

**Evidence of the gap, from the product as it stood.** `grep -rn payments src` returned
nothing. `documents` carried `paid_on`, `paid_method` and `paid_note` and a status that was
either `paid` or not, so a part payment had nowhere to go. `money.ts`'s own header said it
out loud: "There is no payments table in this schema — an invoice is paid in full on
`paid_on` or it is not paid — so Collected is the total of the paid invoices and part
payments do not exist yet." A deposit needed two invoices, which is ruling R7 and which the
CPO round recorded as deferred rather than solved (`docs/rounds/2026-09-20-cpo-cdqo-record.md`
§6.1). Receivables reported an invoice's **total**, so an invoice with a deposit against it
overstated the debt by the deposit.

**The workaround avoided.** A spreadsheet of payments open beside the CRM — which is
exactly the thing this product exists to replace, and the one place where being wrong costs
the owner real money.

**Why nothing existing could reasonably solve it.** Two invoices per deposit doubles the
paperwork the customer receives, spends two invoice numbers on one job, and still cannot
record that the balance arrived by transfer while the deposit was cash. The `paid_note`
field is free text no report can read.

## Candidates considered

| candidate | verdict | reason |
| --- | --- | --- |
| Payments as records, with balances and a customer statement | **build now** | the whole of this return |
| Refunds and credit notes | later | no evidence yet of an owner issuing one; a void plus a re-raise covers the cases seen, and a credit note is a numbered document with its own sequence, which is a second feature |
| Payment import (a bank CSV) | later | PX-2 already records it; it needs a mapping UI and a matching rule, and the product deliberately never watches a bank account |
| Deposit request on a quote | later | PX-2; it is a document change, not a payments change |
| A payment against a customer rather than an invoice (unapplied cash) | reject | PX-5 fixes payments to invoices; unapplied cash needs an allocation model, and a trade owner is paid for a job, not on account |
| Multi-currency payments | reject for now | PX-2; the workspace has one currency and the whole money layer assumes it |
| Payment reminders that send | reject | the product promise is that Helix never sends |

## DELIVERED

Thirteen commits on main. Lead: `871de82`, `ccc40e3`, `fae3c78`, `a862bf8`, `4f314fe`.
W1 (data): `d8631d2`, `e8ada46`. W2 (interface): `02c9c01`, `a44b592`, `8797bc8`.
W3 (PDF, export, reports): `d9bf4d9`, `7ffa795`, `7f734f8`.

**The smallest complete version, all of it built.**

1. **Data.** `drizzle/0006_payments.sql` (idx 6) and the `payments` block in `schema.ts`: amount,
   day, method, reference, note, hung off the invoice. `document_id` is RESTRICT so nothing can
   destroy the record of what a customer paid as a side effect of deleting something else;
   `deal_id` is denormalised from the document and SET NULL; `amount_cents > 0` and the method
   enum are CHECKed at the table. The backfill writes one payment per already-paid invoice for
   its own total on its own `paid_on`, method `other`, keeping the owner's free-text
   `paid_method` in the note.
2. **Repository.** `src/db/repos/payments.ts`: create, edit, remove (soft, undoable), restore,
   purge, `clearForDocument`, the lists a screen needs, and `recordFullPayment` — which is what
   the one-click "Mark paid" now does. Zod validation; a payment cannot exceed the balance unless
   the caller asks on purpose, and the refusal names the balance; a payment cannot be dated in
   the future. **Status is derived, never typed**: `documents.deriveInvoiceStatus` is the one
   rule and `recomputeInvoiceStatus` writes it inside the same transaction as every payment
   write. `documents.markPaid` and `markUnpaid` are gone.
3. **Money.** `collectedCents` is the sum of payments, by `paid_on` over a period — a fifth clock
   the header comment now names. `outstandingCents` is sent+partial totals less their payments.
   New: `invoiceBalanceCents`, `invoiceBalances`, `customerBalanceCents`, `paymentsByMethod`,
   `statementRows`. The payments join is pre-aggregated per document, so a three-payment invoice
   cannot multiply its own total — the fan-out trap the file header warns about.
4. **Interface.** A Payments card on the invoice page (date, method, reference, amount, running
   balance; add, edit, remove with an undo toast), a Record payment dialog (amount defaults to
   the balance, DatePicker, method Combobox), the status pill's "Partially paid", a Balance
   column and a "Has a balance" filter on the list, a Balance figure and a recent-payments list
   on contact and company pages, and "Collected $X of $Y" on a partly collected job.
5. **PDF.** "Paid to date" and "Balance due" on an invoice that has payments, with each payment
   listed when there is more than one, measured into the existing page-break machinery. A new
   Statement PDF per contact or company: opening balance, every invoice and payment in date
   order with a running balance, closing balance, same brand faces as the invoice.
6. **Export.** A `payments` entity in the everything zip and the by-list export. Live payments
   whose invoice is also live. **Not indexed for search** — a payment has no words of its own
   worth matching, and it is reached through its invoice, its customer or its job, all indexed.
7. **Reports.** Revenue's Collected is payments by `paid_on`, with a caption that says so, plus a
   "Payments by method" table for the period. Receivables reports the balance, not the total,
   with a quiet "Partially paid" indicator and aging by due date over balances.

## Acceptance

| id | criterion | result | evidence |
| --- | --- | --- | --- |
| A-1 | 0006 applies on a populated 0005 workspace with identical figures | **pass** | `tests/repo/payments/backfill.test.ts` seeds a 0005 workspace (draft/sent/paid/void, zero-total paid, paid with a trashed deal, paid with no deal, soft-deleted paid, two months), reads every figure through the pre-change formula reproduced verbatim as SQL, migrates, and compares the real `money.ts`/`receivables.ts` field by field. Separately verified by hand against SQLite: v7-shaped unique ids sorting in the invoices' creation order, both CHECKs armed, RESTRICT armed. |
| A-2 | status derivation and refusals proven | **pass** | `tests/repo/payments/derivation.test.ts`, `overpayment.test.ts`, `undo.test.ts`; `tests/unit/payments/balance.test.ts`. The overpayment test asserts nothing is written, which is the transaction-rollback check, not just the throw. |
| A-3 | every UI surface exists and is exercised by the e2e spec | **pass** | `tests/e2e-mac/specs/px-a-payments.e2e.ts`, 2 tests: partial → Partially paid → rest → Paid → remove → Partially paid → undo, the Balance column and the "Has a balance" filter, and the Statement dialog through to the path the app asks to write. |
| A-4 | PDF balance lines and the statement verified by reading text back, plus screenshots | **pass** | `tests/unit/invoices/pdfText.test.ts` inflates the content stream and decodes the text operators through the renderer's own StandardFonts fallback: "Paid to date", "Balance due" and the figures are present with payments and **absent** without, and the statement carries its opening balance, rows and closing line. Eight screenshots in `tests/e2e-mac/.cache/screens/px-a/` (not committed), reviewed. |
| A-5 | export includes payments | **pass** | `tests/repo/payments/exportPayments.test.ts` and the pinned lists in `tests/repo/data/export.test.ts`, including the exclusion of a payment whose invoice is in the Trash. |
| A-6 | full vitest, typecheck, build, e2e green | **pass** | see Verification |
| A-7 | this return with proposed CONTRACTS and Help text | **pass** | below |
| A-8 | tree clean, nothing running | **pass** | `dist-pxa` removed; no processes; only other leads' files dirty |

## Verification

| check | result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | clean (the pre-existing chunk-size warning only) |
| `npx vitest run` | 218 files, **2,706 passed / 3 skipped, 0 failed** (2,373 at base) |
| e2e on 4300–4303, `dist-pxa` (removed after) | `px-a-payments` 2 passed; with `invoices` + `revenue` + `records`, **43 passed** |
| PDF evidence | 5 text-readback assertions; 8 screenshots under `tests/e2e-mac/.cache/screens/px-a/` |
| migration by hand | backfill run against a seeded 0005-shaped table: 3 payments for 3 eligible invoices, zero-total and void and quote skipped, ids unique and v7-shaped and in creation order |

Not available here, unchanged from previous rounds: a real window, the keychain, real files, HTTP,
restore, workspace switch. The macOS harness stubs every Tauri command, so the statement's save
proves the app asked to write the right bytes to the right path, not that a PDF reached a disk.

## Deviations

1. **Soft-deleting a document does not cascade to its payments.** My first version did, keyed on
   the document's `deleted_at`, and my own test caught it resurrecting a payment the owner had
   deliberately removed — `payments.remove` then `documents.softDelete` land in the same
   millisecond. Payments stay live behind a trashed invoice and are invisible because every money
   query joins `documents` and tests `d.deleted_at IS NULL`. Purge is where they are destroyed,
   deliberately. `tests/repo/invoices/documentPayments.test.ts`.
2. **Payment undo is the repository's own inverse, not `changeLog.undoBatch`.** Only
   `payments.restore` recomputes the invoice status; a generic row replay would leave the status
   stale. `payment` is therefore deliberately absent from `changeLog`'s `TABLE_FOR_ENTITY`, and
   payments do not enter the ⌘Z stack. change_log rows are still written for the trail.
3. **Files taken outside the ownership table**, all minimal and all because the payments table
   made them wrong: `src/db/repos/trash.ts` (purge a document's payments first),
   `src/features/onboarding/lib/sampleData.ts` (same, in the example's removal SQL, and the
   example's paid invoice now carries a real payment), `src/features/data/lib/exportRun.ts`
   (the export entity), `tests/repo/data/export.test.ts` and `tests/repo/leads/money.test.ts`
   (fixtures that wrote `status = 'paid'` with no payment behind it).
4. **`d8631d2` is missing its `Co-Authored-By` trailer** (W1's, caught after the fact). Left
   alone under the standing no-amend rule.
5. **`MarkPaidDialog.tsx`'s deletion landed inside `163c561`**, a Lead B commit about Schedule
   screens, because that agent staged broadly. The end state is right. Worth Fable auditing that
   commit for other unintended inclusions.
6. **`drizzle/meta` has no snapshot for 0006 or 0007.** A `drizzle:generate` run mid-round
   re-diffed from the 0005 snapshot and swept Lead B's `tasks` columns into a combined migration;
   I reverted it and hand-wrote 0006. The chain needs a coordinator pass or the next generate
   does the same thing.

## Escalations

1. **Ruling R7 is superseded in practice, and should be recorded as such.** A deposit no longer
   needs a deposit invoice plus a balance invoice; it is a partial payment on the one invoice.
   PX-5 already says this — R7's entry in `docs/rounds/2026-09-20-cpo-cdqo-record.md` §6.1 is now
   stale text pointing at a deferral that has been built. `createDeposit` and the Deposit dialog
   still exist and still work; nothing was removed.
2. **Today's overdue line is Lead B's to land.** The computation is mine and is done; the exact
   shape is in the contract below.
3. **Search:** payments are not indexed, by design. No change requested of Fable.

## For Lead B: the Today contract

`useOutstandingSummary` (mine, `src/features/invoices/lib/format.ts` + `lib/hooks.ts`) now sums
**balances**, not totals, via `money.invoiceBalances`, and counts partly paid invoices:

```ts
type OutstandingSummary = {
  sentCount: number;          // sent AND partial
  outstandingCents: number;   // the sum of BALANCES
  overdueCount: number;
  worstOverdueDays: number;
  draftCount: number;
  partialCount: number;       // new
};
```

`summarySentence` clause order is unchanged, with one clause added. Exact strings:

- `3 unpaid, $2,150.00 outstanding, 1 part paid, 1 overdue by 12 days.`
- `5 unpaid, $3,000.00 outstanding, 2 part paid.`
- `2 unpaid, $400.00 outstanding.`

`UnpaidInvoices.tsx` (which Today mounts) now shows a partly paid invoice's **balance** as its
money and a neutral "Partially paid" badge beside the due badge. Nothing under
`src/features/today/**` was edited.

## PROPOSED TEXT for `docs/CONTRACTS.md` (Fable to land)

> ## Payments and the money model (LR-PX, 2026-09-20, binding)
>
> ### Payments are records; an invoice's status is derived
>
> `payments` hang off invoices only (decision PX-5). A payment carries an amount in cents
> (CHECKed positive), a local calendar day `paid_on`, a `method` CHECKed against
> `cash | check | card | transfer | other`, an optional reference and note, and a `deal_id`
> denormalised from the document. `document_id` is `ON DELETE RESTRICT`: nothing may destroy the
> record of what a customer paid as a side effect of deleting something else, so every path that
> removes an invoice deletes its payments first, on purpose (`documents.purge`, `trash.purge`,
> the example workspace's removal SQL). Soft delete does **not** cascade — a trashed invoice keeps
> its payments, which are invisible because every money query joins `documents` and tests
> `d.deleted_at IS NULL`, and a restore therefore brings them back unchanged.
>
> An invoice's status is **derived, never typed**. `documents.deriveInvoiceStatus(totalCents,
> paidCents)` is the one rule — `paid` when payments >= total, `partial` when 0 < payments < total,
> `sent` at zero — and `documents.recomputeInvoiceStatus` writes it inside the same transaction as
> every payment create, edit and delete. `INVOICE_STATUSES` is
> `draft | sent | partial | paid | void` and `InvoiceStatus` is exported from `documents.ts`.
> `documents.markPaid` and `markUnpaid` no longer exist: "Mark paid" is
> `payments.recordFullPayment(id)` (a payment for the balance, dated today) and "Mark unpaid" is
> `payments.clearForDocument(id)`. `documents.paid_on`, `paid_method` and `paid_note` are now
> purely a cache of the settling payment and are cleared the moment the invoice is not settled.
>
> ### Payment rules
>
> A payment is refused, with a `ValidationError` naming the fix, when: the document is a quote;
> the invoice is a draft ("send it before recording a payment"); the invoice is void; the amount
> is zero or negative; `paid_on` is in the future; or the amount exceeds the remaining balance
> unless the caller passes `allowOverpayment: true` — the refusal names the balance. Voiding an
> invoice that holds payments is refused and names the way out. Undo of a payment is
> `payments.restore`, not `changeLog.undoBatch`: only the repository's own restore recomputes the
> invoice status, so `payment` is deliberately absent from `changeLog`'s `TABLE_FOR_ENTITY`.
>
> ### The five numbers, and the fifth clock
>
> `Collected` is the sum of payments. Over a period it falls on the **payment's own day**
> (`payments.paid_on`), which is a fifth clock beside the four `money.ts` already names.
> `Outstanding` is the totals of `sent` and `partial` invoices less their payments. `Invoiced`
> counts `sent`, `partial` and `paid`. Every payments join is pre-aggregated per document before
> it reaches `documents`, so an invoice with several payments cannot multiply its own total.
> Payments are **not** indexed for search: a payment has no words of its own, and it is reached
> through its invoice, its customer or its job.
>
> ### `onDocumentStatusChanged`
>
> `documents.onDocumentStatusChanged(listener): () => void` registers a listener called with
> `{ document, from, to }` inside the same write as the status change, in registration order,
> after the document row and its timeline line and before the write lock is released. A listener
> that throws fails the whole write, so a rule that creates a task lands with the status or not at
> all. `accept()` announces its own quote → accepted move because it does not go through
> `setStatus`. Payments do not use this seam: the status recompute is a direct call.
>
> ### `saveStatementPdf`
>
> `src/features/invoices/lib/statementFile.ts` exports
> `saveStatementPdf({ ref: { contactId, companyId }, name, fromDay, toDay }): Promise<{ path: string | null }>`
> — `fromDay`/`toDay` are inclusive local days, and `path` is null when the owner cancels the save
> dialog. It is what the "Statement…" button on a contact or company money card calls.

## PROPOSED TEXT for Help (`src/features/help/lib/content.ts`, Fable to land)

In `HELP_INVOICES`, the third paragraph's payment sentence is now wrong — it describes a dialog
that no longer asks for the date and the method. Replace:

> "When the money actually arrives, press Mark paid and say when it came in, how, and anything
> worth a note, since Helix does not watch a bank account and this is the only record of it."

with:

> "When the money arrives, press Mark paid to settle the invoice in full today in one click, or
> Record payment to log a deposit or part of the total with its own date, method and reference.
> Each payment is its own line under the invoice, with the balance still owed beside it, and you
> can correct or remove one at any time. Helix does not watch a bank account, so these lines are
> the only record of what came in."

And add, at the end of that section:

> "A customer's own page adds up what they still owe you across every invoice, and the Statement
> button there makes a PDF for any period: every invoice and every payment in date order, with the
> closing balance. The Revenue report counts money on the day it arrived rather than the day you
> billed it, and breaks the period down by how you were paid."

## Handoff

Nothing running; `dist-pxa` removed; my paths are committed. The 0006 snapshot gap (deviation 6),
the stale R7 entry (escalation 1) and the `163c561` audit (deviation 5) are Fable's. Lead B has
everything it needs for Today in the contract above.
