/**
 * Coming up: the recurring reminders due inside the next seven days.
 *
 * It sits directly under Due now, because it answers the same question with a
 * longer memory - Due now is what the owner promised this week, Coming up is
 * what the season promised. A rule whose date has already passed and which
 * nobody acted on is in here too, at the top, with the number of days said out
 * loud; it is not moved into Due now, because a reminder is not a task and
 * conflating the two would mean "Done" on this screen meant two different
 * things.
 *
 * Two controls per row and no more. "Done" advances the date and writes the
 * timeline entry. "Skip this one" advances the date and says nothing happened,
 * which is the honest option for a spring cleanup the customer cancelled.
 */

import { Link } from "wouter";
import { CheckCircle } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import { formatDateDisplay } from "@/lib/dates";
import { describeInterval } from "@/db/repos/recurring";
import type { RecurringDue } from "@/db/repos/recurring";
import {
  useComingUp,
  useCompleteRule,
  useSkipRule,
} from "@/features/recurring/lib/hooks";

/** "Was due 3 days ago", "Due today", "Due in 4 days". */
export function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Due today";
  if (daysUntil < 0) {
    const days = Math.abs(daysUntil);
    return days === 1 ? "Was due 1 day ago" : `Was due ${days} days ago`;
  }
  return daysUntil === 1 ? "Due tomorrow" : `Due in ${daysUntil} days`;
}

function RowActions({ entry }: { entry: RecurringDue }) {
  const complete = useCompleteRule();
  const skip = useSkipRule();

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconLeft={<CheckCircle size={16} weight="bold" aria-hidden="true" />}
        loading={complete.isPending}
        loadingLabel="Saving"
        onClick={() => {
          complete.mutate(entry.rule, {
            onSuccess: (next) =>
              toast.success(
                `Done: ${entry.rule.title}. Next one ${
                  formatDateDisplay(next.nextDueOn) || next.nextDueOn
                }.`,
              ),
            onError: () => toast.error(`"${entry.rule.title}" did not save.`),
          });
        }}
      >
        Done
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={skip.isPending}
        loadingLabel="Skipping"
        onClick={() => {
          skip.mutate(entry.rule, {
            onSuccess: (next) =>
              toast.success(
                `Skipped. ${entry.rule.title} comes back ${
                  formatDateDisplay(next.nextDueOn) || next.nextDueOn
                }.`,
              ),
            onError: () => toast.error(`"${entry.rule.title}" did not save.`),
          });
        }}
      >
        Skip this one
      </Button>
    </>
  );
}

export function ComingUpSection() {
  const { data, isLoading } = useComingUp();
  const rows = data ?? [];
  const overdue = rows.filter((entry) => entry.daysUntil < 0).length;

  return (
    <Section
      id="coming-up"
      title="Coming up"
      count={rows.length}
      note={
        overdue > 0
          ? overdue === 1
            ? "1 already past"
            : `${overdue} already past`
          : undefined
      }
      isLoading={isLoading}
      isEmpty={rows.length === 0}
      empty={{
        title: "Nothing comes back around this week",
        description:
          "A reminder is work that repeats: a spring cleanup every year, a filter change every three months. Set one on a customer and it turns up here a week before it is due.",
        action: (
          <Link
            href="/recurring"
            className="inline-flex h-[var(--control-h)] flex-none items-center justify-center border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-[var(--space-4)] text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)] no-underline hover:bg-[var(--color-hover)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            See every reminder
          </Link>
        ),
      }}
    >
      {rows.map((entry) => (
        <Row
          key={entry.rule.id}
          badge={
            entry.daysUntil < 0 ? (
              <Badge tone="warning">{whenLabel(entry.daysUntil)}</Badge>
            ) : (
              <Badge tone="neutral">{whenLabel(entry.daysUntil)}</Badge>
            )
          }
          title={entry.rule.title}
          titleText={entry.rule.title}
          subtitle={
            entry.label && entry.href ? (
              <>
                <Link
                  href={entry.href}
                  className="text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  {entry.label}
                </Link>
                <span className="text-[var(--color-text-faint)]">
                  {" "}
                  · {describeInterval(entry.rule.everyN, entry.rule.unit).toLowerCase()}
                </span>
              </>
            ) : (
              describeInterval(entry.rule.everyN, entry.rule.unit)
            )
          }
          subtitleText={entry.label ?? undefined}
          actions={<RowActions entry={entry} />}
        />
      ))}
    </Section>
  );
}
