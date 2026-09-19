/**
 * Recent activity: the last twenty timeline entries across every record.
 *
 * This is the only section on Today that is not a to-do list. It exists so the
 * owner can answer "what did I do yesterday?" without opening anything, and so
 * that a background event — a lead arriving, an import finishing, a merge —
 * is visible somewhere he actually looks.
 *
 * System entries are included and marked. They are the ones he did not write,
 * and hiding them would make the trail lie.
 */

import { Link } from "wouter";
import { Section } from "@/features/today/components/Section";
import { useRecentActivity } from "@/features/today/lib/useToday";
import { formatDateTimeDisplay, formatRelative } from "@/lib/dates";

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call logged",
  email: "Email logged",
  meeting: "Meeting",
  text: "Text",
  system: "System",
};

export function RecentActivitySection() {
  const { data, isLoading } = useRecentActivity(20);
  const entries = data ?? [];

  return (
    <Section
      id="recent-activity"
      title="Recent activity"
      isLoading={isLoading}
      isEmpty={entries.length === 0}
      empty={{
        title: "No activity yet",
        description:
          "Calls, notes, emails and stage changes all land here as you record them, newest first, across every contact, company and deal.",
      }}
    >
      {entries.map((entry) => {
        const kindLabel = KIND_LABEL[entry.kind] ?? "Entry";
        return (
          <li
            key={entry.id}
            className="flex gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-3)] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-[var(--space-2)]">
                <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
                  {kindLabel}
                </span>
                {entry.linkHref && entry.linkLabel ? (
                  <Link
                    href={entry.linkHref}
                    className="max-w-[320px] truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                    title={entry.linkLabel}
                  >
                    {entry.linkLabel}
                  </Link>
                ) : null}
                <span
                  className="tabular ml-auto flex-none text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
                  title={formatDateTimeDisplay(entry.occurredAt)}
                >
                  {formatRelative(entry.occurredAt)}
                </span>
              </div>
              {entry.body ? (
                <p className="mt-[var(--space-1)] line-clamp-2 text-[length:var(--text-base)] text-[var(--color-text-muted)]">
                  {entry.body}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </Section>
  );
}
