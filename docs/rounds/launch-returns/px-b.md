# LR-PX-B return — Schedule, timed visits and calendar export

TASK: LR-PX-B / attempt 1 / packet rev 1
STATUS: **submitted** (not self-accepted). Ten commits on `main`, `6898fe0`..`5ec4e12`, nothing
pushed, tree clean, no dist and nothing running.

## NOTICE TO FABLE — cross-lead contract 1 has landed (first commit)

Commit `6898fe0` — `feat(tasks): source, place and duration on a task (LR-PX-B contract 1)`.

Lead C can build against this now:

```ts
tasks.create({
  title,
  dueOn?, dueAt?,
  contactId?, companyId?, dealId?,
  source?: "user" | "automation",   // NEW, defaults to "user"
  place?: string | null,            // NEW, free text
  durationMinutes?: number | null,  // NEW, 1..1440
})
```

- `drizzle/0007_visits.sql` adds `tasks.source` (TEXT NOT NULL DEFAULT 'user', indexed),
  `tasks.place` (TEXT), `tasks.duration_minutes` (INTEGER), and journal entry idx 7.
  Every existing row backfills to `source = 'user'` as SQLite adds the column.
- `tasks.update` takes the same three fields; `tasks.list` gains `source` and `timedOnly` filters,
  so "every task a rule wrote" is `tasks.list({ source: "automation" })`.
- The old API is untouched: `tasks.create({ title })` still works and still writes `source: 'user'`.
- Proof: `tests/repo/tasks/visitColumns.test.ts` (7 tests), including 0007 landing on a workspace
  that already holds tasks and `tasks.create` without any new field.

Second commit `ac06868` carries the Schedule's internal seams and two small shared edits Fable
should know about, both additive: `qk.schedule(from, to)` in `src/app/queryClient.ts`, and one more
`invalidateQueries({ queryKey: ["schedule"] })` line in `invalidateRecords()`
(`src/features/records/lib/mutations.ts`), plus an optional `endAt` on `CalendarSubject` in
`src/features/records/components/AddToCalendarButton.tsx` so a visit's duration reaches the .ics.

## OWNERSHIP TAKEN (declared, per the packet's "identify and take it")

The task UI the packet told me to find is not in `src/features/today`: it is
`src/features/records/components/TaskComposer.tsx`, `TaskRow.tsx` and `TaskRail.tsx`, with the
screen at `src/features/records/screens/TasksScreen.tsx`. Lead B has taken the first two for this
phase. Lead C's records ownership (`ContactsScreen.tsx`, the deals list/board bulk selection) does
not overlap them. Also taken: `src/app/feature.ts` for the one nav-group line that puts
`/schedule` beside `/tasks`.

---

## DELIVERED

A Schedule view over dated work, timed visits, and single-item calendar export.

| commit | what |
| --- | --- |
| `6898fe0` | `0007_visits.sql`: `tasks.source`/`place`/`duration_minutes`; the repo API for all three (cross-lead contract 1) |
| `ac06868` | the seams: `ScheduleItem`, `openVisitDialog`, `calendarSubjectFor`, `CalendarSubject.endAt`, `qk.schedule` |
| `dfc178e` | W1: `feed.ts`, `week.ts`, `labels.ts` and 64 unit tests |
| `f17d361` | the time on a row follows the owner's locale, not a forced 24-hour clock |
| `163c561` | W2: the week and day screens, the week strip, the agenda, the row |
| `c5ec6a1` | W3: the visit dialog, `visit.ts`, Today's schedule section, task time/place/duration fields, the .ics tests |
| `0d1d7c8` | `0009_visit_note.sql`: a visit's note is a field, not a suffix on its title |
| `3f942a5` | the module in the registry: routes, nav, two commands, the mounted dialog |
| `50c5e19` | Today says what is still owed (Lead A's balance wording), plus the schedule section's render tests |
| `5ec4e12` | `px-b-schedule.e2e.ts`, and the two product fixes it found |

## CANDIDATES CONSIDERED

| candidate | call | why |
| --- | --- | --- |
| A week view over dated work | **build now** | The gap this packet names. Every date already exists in the database and no screen put them together. |
| Timed visits with a place and a length | **build now** | A visit is the one thing the owner leaves the house for, and a task could not say when, where or how long. |
| A note on a visit | **build now** (correction) | The dialog needed a field the title could not hold. See DEVIATIONS. |
| One visit exported as .ics | **build now** | The export already existed for a task; it needed the length, the place and the customer's phone. |
| A month view | later | The week is the unit of a trade owner's planning. A month grid is a second layout to maintain for a question he did not ask. |
| Drag to reschedule | later | Worth having, but it needs a drop target per hour and conflict rules; the dialog reschedules in three clicks today. |
| Travel time or route ordering | reject | It needs a map and a distance service. Decision PX-3 already rejected a map view. |
| Recurring visits | later | `recurring_rules` already models "every N units" and shows on the Schedule; making a rule generate timed visits is a second scheduler and PX-4 says there is none. |
| Two-way calendar sync | reject | Helix has no server and never talks to one. The .ics is the whole integration. |

## THE FEATURE

**User and problem.** A trade owner whose week is site visits, estimates and jobs with expected
dates. He keeps that week in a paper diary or in Google Calendar and types it twice, because Helix
knows every one of those dates and shows them one record at a time.

**Evidence of the gap.** No calendar, week or schedule view existed (grep, 2026-09-20). Jobs'
expected dates and reminders were visible only on their own record, or on Today, and only for today.
Tasks had `due_at` but nothing to say where a visit was or how long to allow.

**Correction to the packet's evidence.** "Tasks have `due_at` but there is no UI that sets a time" is
wrong: `TaskComposer` has had a Due time field. The real gaps were the place, the length, the week
view and an export that knew about any of them.

**Workaround avoided.** A second calendar app with no link back to the customer.

**Smallest complete version, as built.**

1. `tasks` carries `source`, `place`, `duration_minutes` and `notes`. A visit is a task with a time
   (PX-6) — no appointments table, so Trash, undo, search, the timeline and Today's buckets all
   work on a visit without being told it exists.
2. `src/features/schedule/**`, registered in `src/app/registry.ts`, at `/schedule` (the week) and
   `/schedule/day/:date`. Commands "Open schedule" and "Schedule a visit". Sidebar: Schedule, Tasks,
   Reminders, adjacent, as the round-3 grouping rule asks.
3. `scheduleItems(range)` derives the week on every read from tasks, deals, recurring rules,
   invoices and invoice schedules. Typed union, injectable reads, fixtures in the unit tests, no
   denormalised table.
4. The visit dialog: title with trade chips, the three type-ahead pickers, DatePicker, a required
   TimePicker, duration chips plus a custom minutes field, a place prefilled from the record's
   address and still editable, and a note. It saves a task with `source: 'user'`, and the same
   dialog edits one from the task row's "Edit time and place".
5. "Add to calendar" writes a `.ics` through the existing save-file path: `UID` from the task id,
   `DTEND` from the duration, `LOCATION` from the place, and a description carrying the customer,
   their phone, the note and where the entry came from. No network.
6. Today gains "Today's schedule" — the day's timed work, and nothing at all when there is none.

## ACCEPTANCE

| # | criterion | result |
| --- | --- | --- |
| B-1 | first-commit contract landed early, Fable told | **pass** — `6898fe0`, then the notice at the top of this file |
| B-2 | feed correct per source, with fixtures | **pass** — `tests/unit/schedule/feed.test.ts`, one fixture per source plus range, sort and missing-link cases |
| B-3 | week/day usable at 1024×700 and 1440, one primary block, no colour literals, no native inputs | **pass** — the header's "Schedule a visit" is the only primary; every colour is a `var(--…)`; dates and times go through the kit pickers |
| B-4 | the visit dialog saves and shows across Schedule, Tasks and Today | **pass** — proven in one e2e test, including after a reload |
| B-5 | the .ics validated by test | **pass** — 15 unit tests plus the e2e assertion on the bytes actually written |
| B-6 | full vitest, typecheck, build, e2e | **pass** — see VERIFICATION |
| B-7 | this return, with CONTRACTS and Help text | **pass** |
| B-8 | tree clean, nothing running | **pass** — `dist-pxb` and its Playwright output removed |

## VERIFICATION

Run at `5ec4e12`:

- `npx vitest run` → **220 files passed, 1 skipped; 2718 tests passed, 3 skipped.**
- `npm run typecheck` → clean.
- `npm run build` → clean.
- `E2E_PORT=4310 E2E_OUT=dist-pxb … px-b-schedule.e2e.ts` → **5 passed.**
- The same run for `today.e2e.ts` and `records.e2e.ts` → **37 passed.**
- Mutation checks on two new guards: adding `"paid"` to the feed's due-invoice statuses fails
  `feed.test.ts > excludes a paid invoice`; making `endOfItem` always return null fails four
  `visitIcs.test.ts` DTEND cases. Both reverted.
- Migration on populated data: `tests/repo/tasks/visitColumns.test.ts` migrates to 0005, writes
  tasks the way a shipped build would, then applies 0007 and 0009 and asserts the backfill and
  `tasks.create({ title })` still working.
- DST: `week.test.ts` pins the 2026-03-08 and 2026-11-01 boundary weeks in `America/New_York`.

## DEVIATIONS

1. **A second migration, `0009_visit_note.sql`.** W3 folded the dialog's note into the task title
   ("Estimate — bring the long ladder") because tasks had one text field. That is lossy where the
   owner meets it — the note becomes part of the title on the Tasks screen, in search, in the
   timeline entry and in the calendar SUMMARY, and re-opening the visit cannot split them apart. I
   rejected it and gave the note a column. 0006/0007/0008 were all taken, so this is **0009**;
   please record the number.
2. **Two shared files edited additively**, both declared: `qk.schedule` in `src/app/queryClient.ts`
   and one `["schedule"]` line in `invalidateRecords()`; `CalendarSubject.endAt` in
   `AddToCalendarButton.tsx`, without which every exported visit was a flat hour.
3. **Worker process failures, recorded not hidden.** W1 amended its own single unpushed commit to
   add the trailer (message only, content unaffected). W3's commit carries no trailer. W2 ran
   `git commit --amend` against the shared index and so swept Lead A's uncommitted deletion of
   `src/features/invoices/components/MarkPaidDialog.tsx` into `163c561`; I audited all three
   commits with `git show --stat` and that one file is the only thing outside my ownership in any
   of them. The deletion is A's own intent and A's working tree had already dropped the import, so
   I left it rather than resurrect a file A meant to remove.
4. **Two product fixes found by my own e2e**, both in W2's files: the arrow keys never reached the
   week (bound to a container nothing focuses), and a week-strip day carried no date attribute.

## ESCALATIONS

- **Migration number 0009** is now used (above).
- `tests/repo/data/purgeSweep.test.ts` failed for me at one point; Fable diagnosed it as a
  clock-dependent defect in the OPS-phase helper and fixed it. Not caused by this phase — since the
  base revision the only change to the purge path is A's payments-before-document block, which is
  not on the failing path.
- `tests/unit/help/content.test.ts` holds `HELP_SECTIONS` to exactly six, so the Help text below
  needs that assertion updated when it lands.

## HANDOFF

Nothing is running. `dist-pxb`, `results-dist-pxb` and `report-dist-pxb` are removed. The three
workers are finished. Files this phase leaves with Lead B's fingerprints outside
`src/features/schedule/**`: `src/db/repos/tasks.ts`, `src/db/schema.ts` (tasks block only),
`src/app/{registry,feature,queryClient}.ts`, `src/features/today/**`,
`src/features/records/components/{TaskComposer,TaskRow,AddToCalendarButton}.tsx`,
`src/features/records/lib/mutations.ts`.

---

## PROPOSED TEXT for `docs/CONTRACTS.md`

### Tasks: a visit is a task with a time (binding)

`tasks` carries four columns added by `drizzle/0007_visits.sql` and `drizzle/0009_visit_note.sql`:

| column | type | meaning |
| --- | --- | --- |
| `source` | TEXT NOT NULL DEFAULT `'user'` | `'user'` or `'automation'`. A rule that writes a task sets `'automation'`; everything a person types is `'user'`. Indexed. |
| `place` | TEXT | Where a visit is. Free text, prefilled from the linked contact's or company's address and then editable. |
| `duration_minutes` | INTEGER | How long to allow, 1..1440. NULL means no length given. |
| `notes` | TEXT | The line the title has no room for: a gate code, what to bring. Never folded into the title. |

`tasks.create` and `tasks.update` accept all four as optional fields; `tasks.list` filters on
`source` and on `timedOnly` (a task with `due_at` set). The pair rule is unchanged: `due_on` is the
day and is always set when any due date exists, `due_at` only refines it.

There is no appointments table (decision PX-6). A visit is a task with `due_at`, and every rule that
already applies to a task — Today's buckets, the Tasks screen's groups, Trash, undo, the timeline
entry, search — applies to it unchanged.

### The schedule feed (binding)

`src/features/schedule/lib/feed.ts` exports

```ts
scheduleItems(range: { from: string; to: string }, deps?: ScheduleDeps): Promise<ScheduleItem[]>
```

`from`/`to` are inclusive local calendar days. It derives the list on every read from five existing
repositories and writes nothing: open tasks by `due_on`, open deals by `expected_on`, active
recurring rules by `next_due_on`, invoices that are `sent` or `partial` by `due_on`, and active
invoice schedules by `next_issue_on`. There is no denormalised schedule table, and adding one would
create a second answer to "when is that".

`ScheduleItem` (`src/features/schedule/lib/types.ts`) is one shape for all six kinds — `visit`,
`task`, `deal-expected`, `recurring-due`, `invoice-due`, `invoice-issue` — carrying the day, the
instant when there is one, the duration, the title, who it is about with a link, the place, the
note, the record's href and the ids. `compareScheduleItems` fixes the order within a day: timed
items first in time order, then all-day items by kind. `deps` exists so the feed is unit-testable
against fixtures; production callers omit it.

The week starts on Monday, everywhere, and `src/features/schedule/lib/week.ts` is the only place
that decides it. `qk.schedule(from, to)` keys the query, and `invalidateRecords()` invalidates
`["schedule"]`, so any records write refreshes a mounted week.

### Calendar export (binding)

One item at a time, through the existing save-file path (`plugin-dialog` + `plugin-fs`), never over
a network. `calendarSubjectFor(item)` maps a `ScheduleItem` onto the `CalendarSubject`
`AddToCalendarButton` already saves: `UID` from the row's id so a second export replaces the first,
`DTEND` from the visit's duration (an hour when there is none), `LOCATION` from the place, and a
`DESCRIPTION` carrying the customer, their phone, the note and the line "Added from Helix CRM."

## PROPOSED TEXT for Help (`src/features/help/lib/content.ts`)

A seventh section — note that `tests/unit/help/content.test.ts` currently holds `HELP_SECTIONS` to
exactly six.

```ts
{
  id: "schedule",
  title: "Your week, and booking a visit",
  paragraphs: [
    "Schedule in the sidebar shows your week: visits you have booked, jobs you expect to start, reminders that have come round, invoices falling due and bills about to go out — all of it read from the records you already keep, so there is nothing separate to maintain. The week runs Monday to Sunday. Use the arrows or the left and right arrow keys to move between weeks, This week to come back, and the date button to jump anywhere.",
    "Schedule a visit asks for a title, a date and a time, how long to allow, and who it is for. Pick the customer and Helix fills in the address it already has for them, which you can change — the van goes where you say it goes. Anything else worth remembering, like a gate code, goes in the note.",
    "A visit is just a task with a time on it, so it also shows on Today and on the Tasks screen, it can be ticked off or snoozed like anything else, and deleting one puts it in the Trash with everything else. To change a time or a place later, open the task's menu and choose Edit time and place.",
    "Add to calendar on any row saves a standard .ics file wherever you choose, and your own calendar takes it from there. The entry carries the customer's name and number, the address and your note, and exporting the same visit twice replaces the first entry instead of making a second. Helix does not connect to your calendar account and does not send anything anywhere.",
  ],
}
```
