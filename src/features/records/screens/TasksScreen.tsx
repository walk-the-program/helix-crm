/**
 * The full Tasks screen: every open (and, toggled on, done) task across every
 * record, grouped Overdue / Today / Next 7 days / Later / Done. Chips resolve
 * a task's linked contact/company/deal from three lists loaded once, because
 * the tasks list itself only carries the foreign keys.
 */
import { useId, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { CheckCircle2, ListTodo, Search } from "lucide-react";
import { Button, EmptyState, Input, PageHeader, Switch, VirtualList } from "@/ui";
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
          <Button variant="secondary" className="min-h-[44px]" onClick={focusComposer}>
            New task
          </Button>
        }
      />

      <div className="flex flex-col gap-[var(--space-4)] py-[var(--space-4)]">
        <div ref={composerRef}>
          <TaskComposer />
        </div>

        <div className="flex flex-wrap items-end gap-[var(--space-4)]">
          <div className="min-w-[260px] flex-1">
            <label
              htmlFor={searchId}
              className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
              />
              <Input
                id={searchId}
                value={search}
                placeholder="Search by title"
                className="pl-[var(--space-8)]"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <label
            htmlFor="tasks-show-done"
            className="flex min-h-[44px] items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
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
          icon={<ListTodo size={24} aria-hidden="true" />}
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
          icon={<Search size={24} aria-hidden="true" />}
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
                    <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-4)] py-[var(--space-3)]">
                      <CheckCircle2
                        size={20}
                        aria-hidden="true"
                        className="text-[var(--color-success)]"
                      />
                      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        Nothing overdue. You are caught up.
                      </p>
                    </div>
                  </section>
                );
              }
              return null;
            }

            return (
              <section key={group.id}>
                <div className="sticky top-0 z-10 mb-[var(--space-2)] flex items-baseline gap-[var(--space-2)] bg-[var(--color-bg)] py-[var(--space-1)]">
                  <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
                    {group.label}
                  </h2>
                  <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {group.tasks.length}
                  </span>
                </div>

                {group.tasks.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualList
                    items={group.tasks}
                    estimateSize={56}
                    ariaLabel={group.label}
                    className="max-h-[520px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                    getKey={(task) => task.id}
                    renderRow={(task) => (
                      <div className="border-b border-[var(--color-border)] px-[var(--space-4)] last:border-b-0">
                        <TaskRow task={task} chips={chipsFor(task)} />
                      </div>
                    )}
                  />
                ) : (
                  <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-4)]">
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} chips={chipsFor(task)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
