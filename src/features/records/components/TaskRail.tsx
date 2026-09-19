/**
 * The task rail on a record page: open tasks first (soonest due first, which
 * is the order `tasksRepo.list` already returns), a collapsed Done
 * disclosure, then a composer scoped to this record.
 */
import type { ReactElement } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/ui";
import { useTasks } from "@/features/records/lib/hooks";
import { TaskRow } from "@/features/records/components/TaskRow";
import { TaskComposer } from "@/features/records/components/TaskComposer";

export function TaskRail(props: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  title?: string;
}): ReactElement {
  const { contactId, companyId, dealId, title } = props;
  const scope = { contactId, companyId, dealId };

  const openQuery = useTasks({ ...scope, openOnly: true });
  const doneQuery = useTasks({ ...scope, doneOnly: true });

  const openTasks = openQuery.data?.rows ?? [];
  const doneTasks = doneQuery.data?.rows ?? [];
  const loading = openQuery.isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? "Tasks"}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        {!loading && openTasks.length === 0 ? (
          <div className="flex flex-col gap-[var(--space-1)]">
            <h4 className="text-[length:var(--text-base)] font-semibold text-[var(--color-accent-ink)]">
              No next step
            </h4>
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Add the one thing you promised to do.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--color-border)]">
            {openTasks.map((task) => (
              <TaskRow key={task.id} task={task} compact />
            ))}
          </div>
        )}

        {doneTasks.length > 0 ? (
          <details className="group">
            <summary
              className={[
                "cursor-pointer list-none select-none",
                "text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]",
                "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
              ].join(" ")}
            >
              Done ({doneTasks.length})
            </summary>
            <div className="mt-[var(--space-2)] flex flex-col divide-y divide-[var(--color-border)]">
              {doneTasks.map((task) => (
                <TaskRow key={task.id} task={task} compact />
              ))}
            </div>
          </details>
        ) : null}

        <TaskComposer
          contactId={contactId}
          companyId={companyId}
          dealId={dealId}
          emphasis="secondary"
        />
      </CardBody>
    </Card>
  );
}
