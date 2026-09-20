/**
 * "/settings" — the index.
 *
 * Four grouped inset lists, in the order `SETTINGS_SECTIONS` fixes: a row per
 * section with its icon and its one line, and a caret on the right saying the
 * row goes somewhere. This is the iOS/System Settings index, and it is the only
 * screen in the feature that does not carry the section list, because it is the
 * section list.
 *
 * The four rows another feature owns say where they land ("Opens the
 * pipeline"), so a jump out of Settings is never a surprise.
 */
import { Link } from "wouter";
import { PageHeader } from "@/ui";
import { CaretRight, ICON_SIZE } from "@/ui/icons";
import { SettingsGroup, SettingsRow } from "@/features/settings/components/SettingsLayout";
import { sectionsByGroup } from "@/features/settings/lib/sections";

const EXTERNAL_HINTS: Record<string, string> = {
  stages: "Opens the pipeline",
  reminders: "Opens reminders",
  trash: "Opens trash",
  setup: "Opens setup",
};

export function OverviewScreen() {
  return (
    <div data-testid="settings-overview" className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Everything you can change about how Helix works and looks."
      />
      <div className="flex flex-col gap-[var(--space-6)]">
        {sectionsByGroup().map((group) => (
          <SettingsGroup key={group.id} label={group.label}>
            {group.sections.map((section) => {
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
                    // The hairline belongs to the link, not to the row inside
                    // it: only the link is a child of the panel, so only it can
                    // tell whether it is the last row.
                    "block border-b border-[var(--color-border)] last:border-b-0",
                    "no-underline hover:bg-[var(--color-hover)] hover:no-underline",
                    "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]",
                    "focus-visible:-outline-offset-2",
                  ].join(" ")}
                >
                  <SettingsRow
                    className="border-b-0"
                    leading={<section.icon size={ICON_SIZE} aria-hidden />}
                    label={<span className="truncate">{section.title}</span>}
                    hint={section.description}
                  >
                    {hint ? (
                      <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
                        {hint}
                      </span>
                    ) : null}
                    {/* A disclosure caret is an indicator beside text, not a
                        row's identifying glyph: 14, like every other caret and
                        check in the product (the canon in src/ui/icons.ts).
                        At ICON_SIZE it was 18 and read heavier than the row
                        icon it pointed away from. */}
                    <CaretRight
                      size={14}
                      weight="bold"
                      className="flex-none text-[var(--color-text-faint)]"
                      aria-hidden
                    />
                  </SettingsRow>
                </Link>
              );
            })}
          </SettingsGroup>
        ))}
      </div>
    </div>
  );
}
