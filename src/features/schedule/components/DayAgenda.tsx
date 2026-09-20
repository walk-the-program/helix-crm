/**
 * One day's line-up: what the owner is doing, in the order he will do it.
 *
 * A day reads as two groups, always in this order: the times he has to be
 * somewhere, earliest first, then the things that are simply true of the day
 * with no clock on them — a job expected, a reminder due, an invoice falling
 * due. `compareScheduleItems` (lib/types.ts) already produced that order;
 * this component only splits the one sorted list into the two groups and
 * never re-sorts either half. The first group carries no heading of its own —
 * each row already shows its time, and repeating the word "Timed" above it
 * would say nothing the rows do not already say. The second sits under one
 * quiet label, "Anytime that day", because those rows have no time to speak
 * for them.
 *
 * The grouped white panel is built fresh here rather than imported from
 * Today's `Section.tsx` — that file belongs to another worker this round —
 * but it is the same shape: one hairline border, no shadow, no radius.
 */
import type { ReactNode } from "react";
import { Button, CardGroupLabel, EmptyState } from "@/ui";
import { useVocabulary } from "@/app/vocabulary";
import { useFormats } from "@/app/formats";
import { openVisitDialog } from "@/features/schedule/lib/visitDialog";
import type { ScheduleItem } from "@/features/schedule/lib/types";
import { ScheduleRow } from "@/features/schedule/components/ScheduleRow";

/** The grouped inset list a day's rows sit in: white surface, one hairline,
 *  hard corners, no shadow at all. */
function Panel(props: { children: ReactNode }) {
  return (
    <div className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
      {props.children}
    </div>
  );
}

export function DayAgenda(props: {
  /** The local calendar day this agenda is for, "YYYY-MM-DD". */
  date: string;
  items: readonly ScheduleItem[];
  isLoading?: boolean;
}) {
  const { date, items, isLoading } = props;
  const vocabulary = useVocabulary();
  const formats = useFormats();

  if (isLoading) {
    return (
      <p role="status" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Reading the database.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Nothing on the books"
          description="No visit, job, reminder or bill falls on this day yet."
          action={
            <Button type="button" variant="secondary" onClick={() => openVisitDialog({ date })}>
              Schedule a visit
            </Button>
          }
        />
      </Panel>
    );
  }

  const timed = items.filter((item) => item.at !== null);
  const untimed = items.filter((item) => item.at === null);

  return (
    <div className="flex flex-col gap-[var(--space-5)]" data-testid="day-agenda">
      {timed.length > 0 ? (
        <Panel>
          <ul className="m-0 list-none p-0">
            {timed.map((item) => (
              <ScheduleRow
                key={item.id}
                item={item}
                vocabulary={vocabulary}
                locale={formats.locale}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {untimed.length > 0 ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <CardGroupLabel>Anytime that day</CardGroupLabel>
          <Panel>
            <ul className="m-0 list-none p-0">
              {untimed.map((item) => (
                <ScheduleRow
                  key={item.id}
                  item={item}
                  vocabulary={vocabulary}
                  locale={formats.locale}
                />
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
