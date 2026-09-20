/**
 * Gone quiet: open deals that have stopped moving (docs/PLAN.md item 11).
 *
 * The rule is in `lib/goneQuiet.ts` and in `deals.goneQuiet()`; this is only
 * the presentation of it. Each row says the number out loud — "No activity for
 * 21 days · Limit 14 days" — because a list that just asserts "these are stale"
 * is a list the owner learns to ignore.
 *
 * Two actions, both one tap. "Log a call" opens the note box and, once saved,
 * the deal has an activity newer than its limit and leaves the section. "Snooze
 * a week" writes a system entry that does the same thing without pretending a
 * conversation happened; the timeline shows that it was deferred, and by whom,
 * rather than hiding it in an invisible column.
 */

import { useState } from "react";
import { Link } from "wouter";
import { CalendarDots, PhoneCall } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import {
  LogCallDialog,
  type LogCallTarget,
} from "@/features/today/components/LogCallDialog";
import {
  useGoneQuiet,
  useLogCall,
  useSnoozeQuietDeal,
  type QuietRow,
} from "@/features/today/lib/useToday";
import { useOpenDealCount } from "@/features/today/lib/useToday";
import { formatMoney } from "@/lib/money";
import { useVocabulary } from "@/app/vocabulary";

function rowName(row: QuietRow): string {
  const contact = `${row.deal.contactFirstName ?? ""} ${row.deal.contactLastName ?? ""}`.trim();
  return row.deal.companyName || contact || row.deal.title;
}

export function GoneQuietSection() {
  const vocabulary = useVocabulary();
  const { data, isLoading } = useGoneQuiet();
  const { data: openCount } = useOpenDealCount();
  const logCall = useLogCall();
  const snooze = useSnoozeQuietDeal();
  const [target, setTarget] = useState<LogCallTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const rows = data ?? [];

  return (
    <>
      <Section
        id="gone-quiet"
        title="Gone quiet"
        count={rows.length}
        note={`Open ${vocabulary.lowerMany} with no activity past their stage's limit`}
        isLoading={isLoading}
        isEmpty={rows.length === 0}
        emptyInline={{
          // "Every open job is moving" is vacuously true on a workspace with
          // no jobs, and reads as a report about work that does not exist
          // (CPO audit, F-LA-6).
          text:
            openCount === 0
              ? `No open ${vocabulary.lowerMany} yet.`
              : `Every open ${vocabulary.lower} is moving.`,
        }}
      >
        {rows.map((row) => {
          const name = rowName(row);
          const detail = `${row.deal.title} · ${row.explanation}`;
          return (
            <Row
              key={row.deal.id}
              badge={
                <Badge tone="neutral" dotColor={row.stageColor}>
                  {row.deal.stageName}
                </Badge>
              }
              title={
                <Link
                  href={`/deals/${row.deal.id}`}
                  className="text-[var(--color-text)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  {name}
                </Link>
              }
              titleText={name}
              subtitle={
                <span className="flex min-w-0 items-baseline gap-[var(--space-2)]">
                  <span className="truncate">{row.deal.title}</span>
                  <span className="shrink-0 whitespace-nowrap">
                    {row.explanation}
                  </span>
                </span>
              }
              subtitleClassName="flex min-w-0"
              subtitleText={detail}
              money={
                row.deal.valueCents > 0
                  ? formatMoney(row.deal.valueCents, row.deal.currency)
                  : undefined
              }
              actions={
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconLeft={<PhoneCall size={16} weight="bold" aria-hidden="true" />}
                    onClick={() => {
                      setTarget({
                        name,
                        contactId: row.deal.contactId,
                        companyId: row.deal.companyId,
                        dealId: row.deal.id,
                      });
                      setDialogOpen(true);
                    }}
                  >
                    Log a call
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconLeft={<CalendarDots size={16} weight="bold" aria-hidden="true" />}
                    loading={snooze.isPending}
                    onClick={() =>
                      snooze.mutate(
                        { dealId: row.deal.id, limitDays: row.limitDays },
                        {
                          onSuccess: () =>
                            toast.success(
                              `${name} is off Today for another ${row.limitDays} days.`,
                            ),
                          onError: () =>
                            toast.error("That deal could not be snoozed."),
                        },
                      )
                    }
                  >
                    Snooze a week
                  </Button>
                </>
              }
            />
          );
        })}
      </Section>

      <LogCallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        target={target}
        saving={logCall.isPending}
        onSave={async (body) => {
          if (!target) return;
          await logCall.mutateAsync({
            body,
            contactId: target.contactId,
            companyId: target.companyId,
            dealId: target.dealId,
          });
          toast.success(`Call logged for ${target.name}.`);
        }}
      />
    </>
  );
}
