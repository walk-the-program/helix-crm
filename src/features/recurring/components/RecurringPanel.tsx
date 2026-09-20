/**
 * The reminders on one record: a chip per rule and the button that adds one.
 *
 * It sits in the details column of a contact or company page, in the same
 * grouped-list vocabulary as the panels around it. A rule is one line - what it
 * is called, when the next one is due, and how often - because on a record page
 * the reminder is a fact about the customer, not a screen of its own. The
 * screen of its own is "/recurring".
 *
 * Nothing here is the page's primary block: the contact page already spends
 * that on the phone number.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowsClockwise, PencilSimple, Plus } from "@/ui/icons";
import { Badge, Button, Card, CardRow, IconButton, Tooltip } from "@/ui";
import { formatDateDisplay } from "@/lib/dates";
import { describeInterval, type RecurringRule } from "@/db/repos/recurring";
import { useRecurringFor } from "@/features/recurring/lib/hooks";
import { RuleDialog } from "@/features/recurring/components/RuleDialog";

/** "Due 12 Apr 2027" or "Due today", plus the interval. */
export function ruleLine(rule: RecurringRule, reference: string): string {
  const when =
    rule.nextDueOn === reference
      ? "Due today"
      : rule.nextDueOn < reference
        ? `Due ${formatDateDisplay(rule.nextDueOn) || rule.nextDueOn}, still open`
        : `Due ${formatDateDisplay(rule.nextDueOn) || rule.nextDueOn}`;
  return `${when} · ${describeInterval(rule.everyN, rule.unit).toLowerCase()}`;
}

export function RecurringPanel(props: {
  contactId?: string;
  companyId?: string;
  /** The record's own name, for the dialog's sentence. */
  aboutLabel?: string | null;
  reference: string;
}) {
  const { contactId, companyId, aboutLabel, reference } = props;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const { data } = useRecurringFor({ contactId, companyId });
  const rules = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-[var(--space-3)]" data-testid="recurring-panel">
      {rules.length === 0 ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Nothing comes back around for this one yet.
        </p>
      ) : (
        <Card>
          {rules.map((rule) => (
            <CardRow key={rule.id} data-testid="recurring-chip">
              <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)] py-[var(--space-1)]">
                <span className="truncate text-[length:var(--text-base)] text-[var(--color-text)]" title={rule.title}>
                  {rule.title}
                </span>
                <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {ruleLine(rule, reference)}
                </span>
              </span>
              <span className="flex flex-none items-center gap-[var(--space-2)]">
                {rule.active ? null : <Badge tone="neutral">Paused</Badge>}
                <Tooltip content="Edit this reminder">
                  <IconButton
                    label={`Edit "${rule.title}"`}
                    size="sm"
                    icon={<PencilSimple size={16} weight="bold" aria-hidden="true" />}
                    onClick={() => setEditing(rule)}
                  />
                </Tooltip>
              </span>
            </CardRow>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
          onClick={() => setAdding(true)}
        >
          Remind me every...
        </Button>
        {rules.length > 0 ? (
          <Link
            href="/recurring"
            className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            <ArrowsClockwise size={16} weight="regular" aria-hidden="true" /> All reminders
          </Link>
        ) : null}
      </div>

      <RuleDialog
        open={adding}
        onOpenChange={setAdding}
        target={{ contactId: contactId ?? null, companyId: companyId ?? null }}
        aboutLabel={aboutLabel ?? null}
      />
      <RuleDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        target={{ contactId: contactId ?? null, companyId: companyId ?? null }}
        rule={editing}
        aboutLabel={aboutLabel ?? null}
      />
    </div>
  );
}
