# LR-PX-B return — Schedule, timed visits and calendar export

TASK: LR-PX-B / attempt 1 / packet rev 1
STATUS: **in progress** — this file is being written as the workstream lands. The block below is the
first-commit notice Fable is waiting on; everything under it fills in before the workstream is
submitted.

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
