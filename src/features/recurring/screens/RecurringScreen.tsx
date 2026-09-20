/**
 * Reminders: every recurring rule in the workspace, soonest first.
 *
 * One table, sorted by the next date, with the paused rules under the live
 * ones. The columns are the four facts that decide whether a rule is right -
 * when it is next due, what it is, who it is about, how often - plus when it
 * was last done, which is the column that tells the owner whether he has been
 * keeping the promise.
 *
 * The screen's one primary block is "New reminder", because a Reminders screen
 * with nothing on it has exactly one thing to do.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  Table,
  toast,
} from "@/ui";
import { todayLocal } from "@/lib/dates";
import { useFormats } from "@/app/formats";
import {
  describeInterval,
  type RecurringDue,
  type RecurringRule,
} from "@/db/repos/recurring";
import {
  useDeleteRule,
  useRecurringRules,
  useSetRuleActive,
} from "@/features/recurring/lib/hooks";
import { RuleDialog } from "@/features/recurring/components/RuleDialog";

/** The customer, by name, linked to their record. */
function WhoCell({ entry }: { entry: RecurringDue }) {
  if (!entry.label || !entry.href) {
    return <span className="text-[var(--color-text-faint)]">No record attached</span>;
  }
  return (
    <Link
      href={entry.href}
      title={entry.recordDeleted ? `${entry.label} (in Trash)` : entry.label}
      className="block truncate text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
    >
      {entry.label}
      {/* The rule is still attached; the record it is about is in the Trash.
          Saying "No record attached" about it - which is what dropping the
          deleted row from the join used to produce - is a different and
          wrong fact (CPO audit, F-W1-4). */}
      {entry.recordDeleted ? (
        <span className="text-[var(--color-text-faint)]"> (in Trash)</span>
      ) : null}
    </Link>
  );
}

export function RecurringScreen() {
  const reference = todayLocal();
  const formats = useFormats();
  const { data, isLoading } = useRecurringRules({});
  const entries = data ?? [];
  const rules = entries.map((entry) => entry.rule);
  const setActive = useSetRuleActive();
  const remove = useDeleteRule();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [confirming, setConfirming] = useState<RecurringRule | null>(null);

  const liveCount = rules.filter((rule) => rule.active).length;

  return (
    <div className="flex flex-col" data-testid="recurring-screen">
      <PageHeader
        title="Reminders"
        subtitle="Work that comes back around, and when it is next due."
        actions={
          <Button
            type="button"
            variant="primary"
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            onClick={() => setAdding(true)}
          >
            New reminder
          </Button>
        }
      />

      <div className="max-w-[1100px]">
        {isLoading ? (
          <p role="status" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : rules.length === 0 ? (
          <EmptyState
            title="No reminders yet"
            description="A reminder is work that comes back around: a spring cleanup every year, a filter change every three months, a check-in every two weeks. Helix puts it on Today a week before it is due."
            action={
              <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
                Add the first one
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                {/* Widths live on the header row: without them the date and
                    the interval wrap onto two lines in a table that has plenty
                    of room (docs/STATUS.md, "TD primary needs a width hint"). */}
                <TH className="w-[16%] whitespace-nowrap">Next due</TH>
                <TH className="w-[24%]">Reminder</TH>
                <TH className="w-[22%]">About</TH>
                <TH className="w-[14%] whitespace-nowrap">How often</TH>
                <TH className="w-[14%] whitespace-nowrap">Last done</TH>
                <TH className="w-[10%]">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((entry) => {
                const rule = entry.rule;
                const overdue = rule.active && rule.nextDueOn < reference;
                return (
                  <TR key={rule.id} data-testid="recurring-row">
                    <TD className="tabular whitespace-nowrap">
                      <span className={overdue ? "font-medium text-[var(--color-text)]" : undefined}>
                        {formats.date(rule.nextDueOn) || rule.nextDueOn}
                      </span>
                    </TD>
                    <TD>
                      <span className="flex items-center gap-[var(--space-2)]">
                        <span className="truncate font-medium text-[var(--color-text)]" title={rule.title}>
                          {rule.title}
                        </span>
                        {rule.active ? null : <Badge tone="neutral">Paused</Badge>}
                      </span>
                    </TD>
                    <TD>
                      <WhoCell entry={entry} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      {describeInterval(rule.everyN, rule.unit)}
                    </TD>
                    <TD className="tabular whitespace-nowrap">
                      {rule.lastCompletedOn
                        ? formats.date(rule.lastCompletedOn) || rule.lastCompletedOn
                        : "Not yet"}
                    </TD>
                    <TD>
                      <span className="flex items-center justify-end gap-[var(--space-1)]">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(rule)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActive.mutate(
                              { id: rule.id, active: !rule.active },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    rule.active
                                      ? `Paused "${rule.title}"`
                                      : `Resumed "${rule.title}"`,
                                  ),
                                onError: () => toast.error("That reminder did not change."),
                              },
                            );
                          }}
                        >
                          {rule.active ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setConfirming(rule)}
                        >
                          Delete
                        </Button>
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={6}>
                  <span className="tabular text-[var(--color-text-muted)]">
                    {liveCount === 1 ? "1 reminder running" : `${liveCount} reminders running`}
                    {rules.length !== liveCount ? `, ${rules.length - liveCount} paused` : ""}
                  </span>
                </TD>
              </TR>
            </TFoot>
          </Table>
        )}
      </div>

      <RuleDialog open={adding} onOpenChange={setAdding} target={{}} />
      <RuleDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        target={{
          contactId: editing?.contactId ?? null,
          companyId: editing?.companyId ?? null,
        }}
        rule={editing}
      />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming ? `Delete "${confirming.title}"?` : "Delete this reminder?"}
        description="It stops showing up on Today. You can undo this for ten seconds."
        confirmLabel="Delete reminder"
        destructive
        onConfirm={async () => {
          const rule = confirming;
          if (!rule) return;
          setConfirming(null);
          try {
            await remove.mutateAsync(rule);
          } catch {
            toast.error(`Could not delete "${rule.title}".`);
          }
        }}
      />
    </div>
  );
}
