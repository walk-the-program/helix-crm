/**
 * The list of a customer's jobs on a record page: title, stage, value.
 *
 * It was written inline on the company page and nowhere else, which is how the
 * contact page came to have no jobs on it at all — a contact with a live
 * $14,800 job showed a timeline, tasks, reminders and ten field groups, and no
 * route to the job itself. For the half of a trade owner's customers who are
 * people rather than companies, the contact page is the only record page there
 * is (CPO audit, F-LA-5).
 *
 * Extracted here so the two pages cannot drift. The company page still has its
 * own copy for now; it adopts this one when its next edit lands.
 */
import type { ReactElement } from "react";
import { Link } from "wouter";
import { Badge, Card, CardGroupLabel, CardRow, EmptyState } from "@/ui";
import { useFormats } from "@/app/formats";

export type DealsCardRow = {
  id: string;
  title: string;
  valueCents: number;
  currency: string;
  stageName: string;
};

export function DealsCard(props: {
  title: string;
  deals: DealsCardRow[];
  emptyText: string;
}): ReactElement {
  const formats = useFormats();
  return (
    <div>
      <CardGroupLabel className="flex items-baseline gap-[var(--space-2)]">
        <span>{props.title}</span>
        <span className="tabular">{props.deals.length}</span>
      </CardGroupLabel>
      <Card>
        {props.deals.length === 0 ? (
          // The kit's section-level empty, rather than a hand-rolled paragraph:
          // one muted sentence at a row's height, so an empty card is the same
          // shape here, on Today and on every other record panel (kit commit
          // 4c2a8e2; phase two, direction rule 6).
          <EmptyState variant="quiet" title={props.emptyText} />
        ) : (
          props.deals.map((deal) => (
            <CardRow key={deal.id} interactive className="p-0">
              <Link
                href={`/deals/${deal.id}`}
                className="flex min-h-[var(--row-h)] w-full items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
              >
                <span
                  className="min-w-0 truncate text-[length:var(--text-base)] text-[var(--color-text)]"
                  title={deal.title}
                >
                  {deal.title}
                </span>
                <span className="flex shrink-0 items-center gap-[var(--space-3)]">
                  <Badge>{deal.stageName}</Badge>
                  <span className="money text-[length:var(--text-base)] text-[var(--color-text)]">
                    {formats.money(deal.valueCents, deal.currency)}
                  </span>
                </span>
              </Link>
            </CardRow>
          ))
        )}
      </Card>
    </div>
  );
}
