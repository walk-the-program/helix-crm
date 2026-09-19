/**
 * The frame every settings screen sits in: a section rail on the left, the
 * screen on the right, and one breadcrumb back to the index.
 *
 * DESIGN.md: no decoration, one primary action per screen, `--control-h` for
 * every control, accent only where something needs the owner.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/ui";
import { OWNED_SECTIONS } from "@/features/settings/lib/sections";

export function SettingsRail() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Settings sections"
      className="flex w-[216px] shrink-0 flex-col gap-[var(--space-1)]"
    >
      {OWNED_SECTIONS.map((section) => {
        const active = location === section.to;
        return (
          <Link
            key={section.id}
            href={section.to}
            aria-current={active ? "page" : undefined}
            className={[
              "flex min-h-[var(--control-h)] items-center gap-[var(--space-2)]",
              "rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)]",
              "text-[length:var(--text-sm)] no-underline",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              active
                ? "bg-[var(--color-selected)] font-medium text-[var(--color-text)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
            ].join(" ")}
          >
            <section.icon size={18} aria-hidden />
            <span className="truncate">{section.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsScreenFrame(props: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Set on the outermost element so the e2e suite can find the screen. */
  testId: string;
}) {
  const { title, subtitle, actions, children, testId } = props;

  return (
    <div className="flex gap-[var(--space-8)]" data-testid={testId}>
      <SettingsRail />
      {/* Wider than --content-max (a prose cap): these screens carry tables and
          row action clusters, not paragraphs. Individual prose blocks cap
          themselves. */}
      <div className="min-w-0 flex-1 max-w-[920px]">
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={actions}
          breadcrumb={
            <Link
              href="/settings"
              className="inline-flex items-center gap-[var(--space-1)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              <ChevronLeft size={14} aria-hidden />
              Settings
            </Link>
          }
        />
        <div className="pt-[var(--space-6)]">{children}</div>
      </div>
    </div>
  );
}

/** A labelled block inside a settings screen. Not a card: cards are for data. */
export function SettingsBlock(props: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--color-border)] py-[var(--space-6)] first:pt-0 last:border-b-0">
      <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
        {props.title}
      </h2>
      {props.description ? (
        <p className="mt-[var(--space-1)] max-w-[60ch] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {props.description}
        </p>
      ) : null}
      <div className="mt-[var(--space-4)]">{props.children}</div>
    </section>
  );
}

/** label / value pair for the read-only rows on Diagnostics and Workspaces. */
export function DataRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[var(--row-h)] items-center gap-[var(--space-4)] border-b border-[var(--color-border)] py-[var(--space-2)] last:border-b-0">
      <div className="w-[180px] shrink-0 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {props.label}
      </div>
      <div className="min-w-0 flex-1 text-[length:var(--text-base)] text-[var(--color-text)]">
        {props.children}
      </div>
    </div>
  );
}
