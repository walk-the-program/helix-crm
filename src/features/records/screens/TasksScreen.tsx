/**
 * The full Tasks screen: every open (and, toggled on, done) task across every
 * record, grouped Overdue / Today / Next 7 days / Later / Done. Chips resolve
 * a task's linked contact/company/deal from three lists loaded once, because
 * the tasks list itself only carries the foreign keys.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import {
  Button,
  CardGroupLabel,
  EmptyState,
  Input,
  PageHeader,
  Switch,
  VirtualList,
  useRovingRowNav,
  type RowNavProps,
} from "@/ui";
import { focusRingInset } from "@/ui/styles";
import { cn } from "@/ui/cn";
import { contactName } from "@/db/repos/contacts";
import type { Task } from "@/db/repos/tasks";
import {
  useCompanies,
  useContacts,
  useDeals,
  useDebounced,
  useTasks,
} from "@/features/records/lib/hooks";
import { groupTasks } from "@/features/records/lib/taskGroups";
import { TaskComposer } from "@/features/records/components/TaskComposer";
import { TaskRow } from "@/features/records/components/TaskRow";
import type { RecordChipTarget } from "@/features/records/components/RecordChip";

const VIRTUALIZE_THRESHOLD = 200;

export function TasksScreen(): ReactElement {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const debouncedSearch = useDebounced(search, 200);
  const composerRef = useRef<HTMLDivElement | null>(null);

  const tasksQuery = useTasks({}, 1000);
  const { data: contacts } = useContacts({}, 2000);
  const { data: companies } = useCompanies({}, 2000);
  const { data: deals } = useDeals({}, 2000);

  const contactLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts?.rows ?? []) map.set(contact.id, contactName(contact));
    return map;
  }, [contacts]);

  const companyLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const company of companies?.rows ?? []) map.set(company.id, company.name);
    return map;
  }, [companies]);

  const dealLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const deal of deals?.rows ?? []) map.set(deal.id, deal.title);
    return map;
  }, [deals]);

  function chipsFor(task: Task): RecordChipTarget[] {
    const chips: RecordChipTarget[] = [];
    if (task.contactId) {
      const label = contactLabels.get(task.contactId);
      if (label) chips.push({ kind: "contact", id: task.contactId, label });
    }
    if (task.companyId) {
      const label = companyLabels.get(task.companyId);
      if (label) chips.push({ kind: "company", id: task.companyId, label });
    }
    if (task.dealId) {
      const label = dealLabels.get(task.dealId);
      if (label) chips.push({ kind: "deal", id: task.dealId, label });
    }
    return chips;
  }

  const allTasks = tasksQuery.data?.rows ?? [];
  const openCount = allTasks.filter((task) => task.doneAt === null).length;

  const query = debouncedSearch.trim().toLowerCase();
  const visible = useMemo(() => {
    let rows = showDone ? allTasks : allTasks.filter((task) => task.doneAt === null);
    if (query.length > 0) {
      rows = rows.filter((task) => task.title.toLowerCase().includes(query));
    }
    return rows;
  }, [allTasks, showDone, query]);

  const groups = useMemo(() => groupTasks(visible), [visible]);

  function focusComposer() {
    const input = composerRef.current?.querySelector<HTMLInputElement>("input");
    input?.focus();
  }

  const subtitle = tasksQuery.isLoading
    ? "Loading"
    : openCount === 1
      ? "1 open task"
      : `${openCount.toLocaleString()} open tasks`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Tasks"
        subtitle={subtitle}
        actions={
          <Button variant="secondary" onClick={focusComposer}>
            New task
          </Button>
        }
      />

      <div className="flex flex-col gap-[var(--space-4)] py-[var(--space-4)]">
        <div ref={composerRef}>
          <TaskComposer />
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-4)]">
          <div className="min-w-[260px] flex-1">
            <label htmlFor={searchId} className="sr-only">
              Search tasks
            </label>
            <Input
              id={searchId}
              search
              value={search}
              placeholder="Search by title"
              aria-label="Search tasks"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <label
            htmlFor="tasks-show-done"
            className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          >
            <Switch
              id="tasks-show-done"
              checked={showDone}
              onCheckedChange={setShowDone}
              ariaLabel="Show done tasks"
            />
            Show done
          </label>
        </div>
      </div>

      {allTasks.length === 0 && !tasksQuery.isLoading ? (
        <EmptyState
          title="Nothing to do yet"
          description="Tasks are the promises you made. Add the first one and it shows up on Today."
          action={
            <Button variant="secondary" onClick={focusComposer}>
              Add your first task
            </Button>
          }
        />
      ) : query.length > 0 && visible.length === 0 ? (
        <EmptyState
          title={`Nothing matches "${search.trim()}"`}
          description="Clear the search to see every task again."
          action={
            <Button variant="secondary" onClick={() => setSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-6)]">
          {groups.map((group) => {
            if (group.tasks.length === 0) {
              if (group.id === "overdue" && visible.length > 0) {
                return (
                  <section key={group.id}>
                    {/* A sentence, not a panel. A green tick in a box is a
                        coloured glyph and a card that holds one line — neither
                        belongs here (DESIGN.md §10, §11). */}
                    <p className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
                      Nothing overdue. You are caught up.
                    </p>
                  </section>
                );
              }
              return null;
            }

            return (
              <section key={group.id}>
                <div className="sticky top-0 z-10 bg-[var(--color-bg)] py-[var(--space-1)]">
                  <CardGroupLabel className="flex items-baseline gap-[var(--space-2)]">
                    <span>{group.label}</span>
                    <span className="tabular">{group.tasks.length}</span>
                  </CardGroupLabel>
                </div>

                <TaskGroupList tasks={group.tasks} groupLabel={group.label} chipsFor={chipsFor} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One group's rows (Overdue / Today / ...): virtualised past
 * `VIRTUALIZE_THRESHOLD`, a plain fully-mounted list below it - either way,
 * arrow-key navigation with a roving tabIndex (apple-hig-review.md finding 6
 * / top-ten item 9). There is no column strip here (TasksScreen has no
 * sortable columns), so this is arrow-key navigation only.
 *
 * Both branches share the same `TaskRowNav` wrapper; only `scrollAndFocus`
 * differs, because a virtualised row may not be mounted yet (VirtualList asks
 * the virtualizer to scroll to it by index) while every row here is already
 * in the DOM (a plain `scrollIntoView` is honest).
 */
function TaskGroupList(props: {
  tasks: Task[];
  groupLabel: string;
  chipsFor: (task: Task) => RecordChipTarget[];
}): ReactElement {
  const { tasks, groupLabel, chipsFor } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollAndFocus = useCallback((index: number) => {
    const node = containerRef.current?.querySelectorAll<HTMLElement>("[data-row-focus]")[index];
    node?.scrollIntoView({ block: "nearest" });
    node?.focus();
  }, []);

  const nav = useRovingRowNav({
    count: tasks.length,
    scrollAndFocus,
    resetSignal: tasks,
  });

  if (tasks.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualList
        items={tasks}
        ariaLabel={groupLabel}
        className="max-h-[520px] border border-[var(--color-border)] bg-[var(--color-surface)]"
        getKey={(task) => task.id}
        keyboardNav={{}}
        renderRow={(task, _index, rowNav) => (
          <TaskRowNav task={task} chips={chipsFor(task)} nav={rowNav} />
        )}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {tasks.map((task, index) => (
        <TaskRowNav key={task.id} task={task} chips={chipsFor(task)} nav={nav.getRowProps(index)} />
      ))}
    </div>
  );
}

/**
 * The focusable row wrapper: TaskRow itself has no single "open" action (a
 * checkbox, a snooze menu, a delete button - never a record page), so Enter
 * on a focused row clicks the row's own checkbox rather than navigating
 * anywhere. Arrow/Home/End come from `nav` (VirtualList's `keyboardNav` or
 * `TaskGroupList`'s own `useRovingRowNav` call) and are left untouched here.
 */
function TaskRowNav(props: { task: Task; chips: RecordChipTarget[]; nav?: RowNavProps }): ReactElement {
  const { task, chips, nav } = props;
  const rowRef = useRef<HTMLDivElement | null>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    nav?.onKeyDown(event);
    if (event.key === "Enter") {
      rowRef.current?.querySelector<HTMLElement>('[role="checkbox"]')?.click();
    }
  }

  return (
    <div
      ref={rowRef}
      tabIndex={nav?.tabIndex ?? 0}
      onFocus={nav?.onFocus}
      data-row-focus={nav ? "true" : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "border-b border-[var(--color-border)] px-[var(--space-4)] last:border-b-0",
        focusRingInset,
      )}
    >
      <TaskRow task={task} chips={chips} />
    </div>
  );
}
