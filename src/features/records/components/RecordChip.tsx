/**
 * A small link chip pointing at a linked contact, company or deal. Used on
 * task rows (and anywhere else a row needs to name the record it belongs to)
 * without stealing the row's own click - the row usually opens the task's
 * record, or nothing, and the chip opens a different, specific record.
 */
import type { ReactElement, MouseEvent } from "react";
import { Link } from "wouter";
import { Buildings, Handshake, User } from "@/ui/icons";
import { cn } from "@/ui/cn";

export type RecordChipTarget = {
  kind: "contact" | "company" | "deal";
  id: string;
  label: string;
};

const ICON_FOR: Record<RecordChipTarget["kind"], typeof User> = {
  contact: User,
  company: Buildings,
  deal: Handshake,
};

const PATH_FOR: Record<RecordChipTarget["kind"], string> = {
  contact: "/contacts",
  company: "/companies",
  deal: "/deals",
};

/**
 * " (in Trash)" for a linked contact or company whose `deletedAt` is set.
 *
 * The joins that name a linked record (Contact.companyName, Deal.companyName,
 * Deal.contactFirstName/contactLastName) deliberately do not filter on
 * `deletedAt` — dropping the name would read as "No company" on a record that
 * plainly has one, which is worse than saying it was deleted. Hiding it is
 * wrong; this is the one small mark for it instead, shared by ContactsScreen,
 * CompaniesScreen and DealCard so the three screens cannot drift on the
 * wording (CPO audit, F-LA-9 / F-W1-4). `trashSuffix` is the plain string for
 * a `title` attribute; `TrashMark` is the muted-ink element for the visible
 * label, meant to sit inside the same truncating element as the name it
 * follows so a long name plus the suffix still truncates as one line.
 */
export function trashSuffix(deletedAt: string | null): string {
  return deletedAt ? " (in Trash)" : "";
}

export function TrashMark(props: { deletedAt: string | null }): ReactElement | null {
  if (!props.deletedAt) return null;
  return <span className="text-[var(--color-text-faint)]">{trashSuffix(props.deletedAt)}</span>;
}

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
        "border border-[var(--color-border)]",
        "bg-[var(--color-surface)] px-[var(--space-2)] py-[2px]",
        "text-[length:var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-tight)]",
        "hover:bg-[var(--color-hover)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
        className,
      )}
    >
      <Icon size={16} weight="regular" className="shrink-0" aria-hidden="true" />
      <span className="truncate">{target.label}</span>
    </Link>
  );
}
