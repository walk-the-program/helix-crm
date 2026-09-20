/**
 * "Invoices and quotes" on a deal page.
 *
 * Its own component file with one mount line in `DealPage.tsx`, because the
 * deal page belongs to the records feature and two agents editing the same
 * screen is how a rebase goes wrong.
 *
 * Three actions, and which of them exist depends on the deal:
 *
 *   Create quote            always, when the deal has services on it
 *   Create invoice          the one-time lines, billed now
 *   Create this month's     only when a billing schedule exists, which is
 *   invoice                 what a won deal with a monthly service gets
 *
 * The deal page already spends the screen's one primary block on the deal
 * value, so every control here is secondary. That is the rule, not a
 * preference (docs/DESIGN.md section 5).
 *
 * `resolveErrorMessage` / `report` (F-LB-22): a `ValidationError` off
 * `documents.createFromDeal` carries both a generic top-level message
 * ("There is nothing to put on this document.") and, on its `issues`, the
 * specific one ("This deal has no services on it yet. Add one first." vs
 * "...no monthly or yearly services on it.") - the half that actually tells
 * the owner what to do about it. The toast shows the field message when there
 * is one and falls back to the error's own message, then to `fallback`,
 * exactly the way the sibling catalog panel's own local `report` helper
 * already does it. `resolveErrorMessage` is the pure half of that, exported
 * so the choice is unit testable without a toast or a DOM.
 */
import { Link } from "wouter";
import { Button, Badge, CardGroupLabel, toast } from "@/ui";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { ValidationError } from "@/db/errors";
import {
  useCreateFromDeal,
  useDealDocuments,
  useDealSchedule,
  useInvoiceSettings,
  useIssueScheduledInvoice,
} from "@/features/invoices/lib/hooks";
import { dueLabel, isOverdue, statusLabel, statusTone } from "@/features/invoices/lib/format";

export function resolveErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ValidationError && err.issues.length > 0) {
    return err.issues[0].message;
  }
  return err instanceof Error && err.message.trim().length > 0 ? err.message : fallback;
}

function report(err: unknown, fallback: string): void {
  toast.error(resolveErrorMessage(err, fallback));
}

export function DealInvoicesPanel(props: { dealId: string }) {
  const { dealId } = props;
  const { data: documents, isLoading } = useDealDocuments(dealId);
  const { data: schedule } = useDealSchedule(dealId);
  const { data: settings } = useInvoiceSettings();
  const createFromDeal = useCreateFromDeal();
  const issueScheduled = useIssueScheduledInvoice();

  const rows = documents ?? [];

  async function create(kind: "quote" | "invoice") {
    try {
      const created = await createFromDeal.mutateAsync({ dealId, kind });
      toast.success(`Drafted ${created.number}.`);
    } catch (err) {
      report(err, `That ${kind} could not be created.`);
    }
  }

  async function issueThisPeriod() {
    if (!schedule) return;
    try {
      const created = await issueScheduled.mutateAsync(schedule.id);
      toast.success(`Drafted ${created.number}.`);
    } catch (err) {
      report(err, "That invoice could not be created.");
    }
  }

  return (
    <div data-testid="deal-invoices-panel">
      <CardGroupLabel>Invoices and quotes</CardGroupLabel>

      <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-wrap gap-[var(--space-2)] border-b border-[var(--color-border)] p-[var(--space-3)]">
          <Button
            variant="secondary"
            size="sm"
            loading={createFromDeal.isPending}
            onClick={() => void create("quote")}
          >
            Create quote
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={createFromDeal.isPending}
            onClick={() => void create("invoice")}
          >
            Create invoice
          </Button>
          {schedule && schedule.active ? (
            <Button
              variant="secondary"
              size="sm"
              loading={issueScheduled.isPending}
              onClick={() => void issueThisPeriod()}
            >
              Create this month&apos;s invoice
            </Button>
          ) : null}
        </div>

        {schedule ? (
          <p className="border-b border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {schedule.active
              ? `Billing every ${schedule.interval}. Next on ${formatDateDisplay(schedule.nextIssueOn)}.`
              : "Billing is paused on this one."}
          </p>
        ) : null}

        {isLoading ? (
          <p className="px-[var(--space-3)] py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-[var(--space-3)] py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing raised against this one yet.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] last:border-b-0 hover:bg-[var(--color-hover)]"
              >
                <Link
                  href={`/invoices/${row.id}`}
                  className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)] no-underline hover:underline"
                  title={row.number}
                >
                  {row.number}
                </Link>
                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                <span className="tabular flex-none text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {isOverdue(row)
                    ? dueLabel(row.dueOn)
                    : formatDateDisplay(row.issuedOn) || "Draft"}
                </span>
                <span className="money flex-none text-right text-[length:var(--text-base)] text-[var(--color-text)]">
                  {formatMoney(row.totalCents, settings?.currency, settings?.locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
