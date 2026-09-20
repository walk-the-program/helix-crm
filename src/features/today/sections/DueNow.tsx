/**
 * Due now: everything overdue, then everything due today.
 *
 * DESIGN.md makes this the top of the screen and the largest count on it, and
 * requires that every row can be acted on without opening anything. So a row
 * carries three controls and no more: call whoever it is about (when there is
 * a number), mark it done, or push it. The next seven days are deliberately
 * not here — they are on /tasks. Today is what needs him today.
 *
 * Completing and snoozing both leave a ten-second Undo toast, because they are
 * one-tap actions on a dense list and a mis-tap must cost nothing.
 */

import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle, Clock, Phone } from "@/ui/icons";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import {
  useCompleteTask,
  useDueNow,
  useSnoozeTask,
  useUncompleteTask,
  type DueNowRow,
} from "@/features/today/lib/useToday";
import { openTel } from "@/lib/actions";
import { useVocabulary } from "@/app/vocabulary";

function RowActions({ row }: { row: DueNowRow }) {
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const snooze = useSnoozeTask();
  const [calling, setCalling] = useState(false);
  const phone = row.link?.phone ?? null;

  async function call() {
    if (!phone) return;
    setCalling(true);
    try {
      const result = await openTel(phone, {
        contactId: row.link?.contactId ?? null,
        companyId: row.link?.companyId ?? null,
        dealId: row.link?.dealId ?? null,
      });
      // The affordance PLAN item 12 asks for: dialling is not logging, so the
      // timeline entry is one more deliberate tap.
      toast.info(`Calling ${phone}`, {
        duration: 12000,
        action: {
          label: result.logLabel,
          onClick: () => void result.logThis(),
        },
      });
    } catch {
      toast.error(`The phone app did not open. Call ${phone} directly.`);
    } finally {
      setCalling(false);
    }
  }

  return (
    <>
      {phone ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconLeft={<Phone size={16} weight="bold" aria-hidden="true" />}
          loading={calling}
          onClick={() => void call()}
        >
          Call
        </Button>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconLeft={<CheckCircle size={16} weight="bold" aria-hidden="true" />}
        loading={complete.isPending}
        onClick={() => {
          complete.mutate(row.task.id, {
            onSuccess: () => {
              toast.undo(`Done: ${row.task.title}`, () => {
                uncomplete.mutate(row.task.id);
              });
            },
            onError: () => toast.error("That task could not be completed."),
          });
        }}
      >
        Done
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconLeft={<Clock size={16} weight="bold" aria-hidden="true" />}
            aria-label={`Snooze ${row.task.title}`}
          >
            Snooze
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              snooze.mutate(
                { id: row.task.id, when: "tomorrow" },
                { onSuccess: () => toast.success("Moved to tomorrow.") },
              )
            }
          >
            Tomorrow
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              snooze.mutate(
                { id: row.task.id, when: "next-week" },
                { onSuccess: () => toast.success("Moved to next week.") },
              )
            }
          >
            Next week
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function DueNowSection() {
  const vocabulary = useVocabulary();
  const { data, isLoading } = useDueNow();
  const rows = data?.rows ?? [];
  const overdue = data?.overdueCount ?? 0;

  return (
    <Section
      id="due-now"
      title="Due now"
      count={rows.length}
      emphasis
      note={
        overdue > 0
          ? overdue === 1
            ? "1 overdue"
            : `${overdue} overdue`
          : rows.length > 0
            ? "All due today"
            : undefined
      }
      isLoading={isLoading}
      isEmpty={rows.length === 0}
      empty={{
        title: "Nothing is due today",
        description: `Follow-ups you set on a contact, a company or a ${vocabulary.lower} show up here on the day they are due, and stay until they are done.`,
        action: (
          <Link
            href="/tasks"
            className="inline-flex h-[var(--control-h)] flex-none items-center justify-center border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-[var(--space-4)] text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)] no-underline hover:bg-[var(--color-hover)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            See every task
          </Link>
        ),
      }}
    >
      {rows.map((row) => (
        <Row
          key={row.task.id}
          /*
           * Neutral either way. DESIGN.md §5 "What has no colour" names the
           * word "overdue" explicitly, and TaskRow already followed it — this
           * section was the one place in the product still painting a late task
           * yellow, which put an attention colour on the screen that §5 says
           * Today does not have. The words do the work: "Overdue 3 days" is
           * more specific than any tint, and the section's own count above it
           * is the emphasis.
           */
          badge={<Badge tone="neutral">{row.when}</Badge>}
          title={row.task.title}
          titleText={row.task.title}
          subtitle={
            row.link ? (
              <Link
                href={row.link.href}
                className="text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
              >
                {row.link.label}
              </Link>
            ) : (
              "No record attached"
            )
          }
          subtitleText={row.link?.label ?? "No record attached"}
          actions={<RowActions row={row} />}
        />
      ))}
    </Section>
  );
}
