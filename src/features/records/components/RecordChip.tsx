/**
 * A small link chip pointing at a linked contact, company or deal. Used on
 * task rows (and anywhere else a row needs to name the record it belongs to)
 * without stealing the row's own click - the row usually opens the task's
 * record, or nothing, and the chip opens a different, specific record.
 */
import type { ReactElement, MouseEvent } from "react";
import { Link } from "wouter";
import { Building2, Handshake, User } from "lucide-react";
import { cn } from "@/ui/cn";

export type RecordChipTarget = {
  kind: "contact" | "company" | "deal";
  id: string;
  label: string;
};

const ICON_FOR: Record<RecordChipTarget["kind"], typeof User> = {
  contact: User,
  company: Building2,
  deal: Handshake,
};

const PATH_FOR: Record<RecordChipTarget["kind"], string> = {
  contact: "/contacts",
  company: "/companies",
  deal: "/deals",
};

export function RecordChip(props: { target: RecordChipTarget; className?: string }): ReactElement {
  const { target, className } = props;
  const Icon = ICON_FOR[target.kind];

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // The chip's own navigation is the only thing this click should do - it
    // must never also trigger the row's click handler (opening a task's own
    // record, selecting the row, and so on).
    event.stopPropagation();
  }

  return (
    <Link
      href={`${PATH_FOR[target.kind]}/${target.id}`}
      onClick={handleClick}
      title={target.label}
      className={cn(
        "inline-flex min-w-0 max-w-full shrink-0 items-center gap-[var(--space-1)]",
        "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)] px-[var(--space-2)] py-[2px]",
        "text-[length:var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-tight)]",
        "hover:bg-[var(--color-hover)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
        className,
      )}
    >
      <Icon className="h-[var(--space-4)] w-[var(--space-4)] shrink-0" aria-hidden="true" />
      <span className="truncate">{target.label}</span>
    </Link>
  );
}
