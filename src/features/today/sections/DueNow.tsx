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
import { AlarmClock, CheckCircle2, Clock, Phone } from "lucide-react";
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
      toast.error("The phone app did not open.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <>
      {phone ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="min-h-[44px]"
          iconLeft={<Phone size={16} aria-hidden />}
          loading={calling}
          onClick={() => void call()}
        >
          Call
        </Button>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="min-h-[44px]"
        iconLeft={<CheckCircle2 size={16} aria-hidden />}
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
            size="lg"
            className="min-h-[44px]"
            iconLeft={<Clock size={16} aria-hidden />}
            aria-label={`Snooze ${row.task.title}`}
          >
            Snooze
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="min-h-[44px]"
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
            className="min-h-[44px]"
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
  const { data, isLoading } = useDueNow();
  const rows = data?.rows ?? [];
  const overdue = data?.overdueCount ?? 0;

  return (
    <Section
      id="due-now"
      title="Due now"
      count={rows.length}
      needsYou
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
        icon: <CheckCircle2 size={24} className="text-[var(--color-success)]" aria-hidden />,
        title: "Nothing is due today",
        description:
          "Follow-ups you set on a contact, a company or a deal show up here on the day they are due, and stay until they are done.",
        action: (
          <Link
            href="/tasks"
            className="inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] underline underline-offset-4 hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            See every task
          </Link>
        ),
      }}
    >
      {rows.map((row) => (
        <Row
          key={row.task.id}
          needsYou={row.overdue}
          badge={
            row.overdue ? (
              <Badge tone="accent">
                <AlarmClock size={13} aria-hidden /> {row.when}
              </Badge>
            ) : (
              <Badge tone="neutral">{row.when}</Badge>
            )
          }
          title={row.task.title}
          titleText={row.task.title}
          subtitle={
            row.link ? (
              <Link
                href={row.link.href}
                className="underline underline-offset-2 hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
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
