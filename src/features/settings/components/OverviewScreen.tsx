/**
 * "/settings" - the index of every settings section, owned and external
 * alike, in the fixed order `SETTINGS_SECTIONS` defines
 * (docs/DESIGN.md ss3-11: no rail here, this screen *is* the index).
 */
import { Link } from "wouter";
import { PageHeader } from "@/ui";
import { SETTINGS_SECTIONS } from "@/features/settings/lib/sections";

const EXTERNAL_HINTS: Record<string, string> = {
  stages: "Opens the pipeline",
  site: "Opens the website connection",
  backups: "Opens backups",
  trash: "Opens trash",
};

export function OverviewScreen() {
  return (
    <div data-testid="settings-overview">
      <PageHeader
        title="Settings"
        subtitle="Everything you can change about how Helix works and looks."
      />
      <div className="p-[var(--space-6)]">
        <div className="grid grid-cols-2 gap-[var(--space-4)]">
          {SETTINGS_SECTIONS.map((section) => {
            const hint = section.external
              ? (EXTERNAL_HINTS[section.id] ?? "Opens elsewhere")
              : null;
            return (
              <Link
                key={section.id}
                href={section.to}
                data-testid="settings-section-link"
                data-section={section.id}
                className={[
                  "flex items-start gap-[var(--space-3)] no-underline",
                  "rounded-[var(--radius-md)] border border-[var(--color-border)]",
                  "bg-[var(--color-surface)] p-[var(--space-4)]",
                  "hover:bg-[var(--color-hover)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                ].join(" ")}
              >
                <section.icon
                  size={20}
                  className="mt-[2px] shrink-0 text-[var(--color-text-muted)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                    {section.title}
                  </div>
                  <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {section.description}
                  </p>
                  {hint ? (
                    <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
                      {hint}
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
