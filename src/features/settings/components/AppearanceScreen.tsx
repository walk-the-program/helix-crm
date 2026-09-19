/**
 * "/settings/appearance" — theme and density.
 *
 * Both live in helix.json, not the workspace database
 * (src/app/appSettings.ts), and both apply live: no Save button, the change is
 * visible on <html> the instant it is picked.
 *
 * Three grouped lists: the two choices, then a sample that is drawn from the
 * real tokens, so the owner sees what he is picking rather than reading about
 * it. The sample is deliberately made of a name, a next step and one list row —
 * the three things every screen in the product is made of.
 */
import { useAppearance } from "@/app/hooks";
import type { Density, Theme } from "@/app/appSettings";
import {
  SettingsChoiceRow,
  SettingsGroup,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";

const THEME_OPTIONS: { value: Theme; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "The default. Easiest to read in daylight." },
  { value: "dark", label: "Dark", description: "Easier on the eyes late at night." },
  { value: "auto", label: "Auto", description: "Follows your Mac or Windows setting." },
];

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  {
    value: "comfortable",
    label: "Comfortable",
    description: "The default. More room between rows.",
  },
  {
    value: "compact",
    label: "Compact",
    description: "About a third more rows on a list. Text never gets smaller than 11px.",
  },
];

export function AppearanceScreen() {
  const { theme, density, setTheme, setDensity } = useAppearance();

  return (
    <SettingsScreenFrame
      title="Appearance"
      testId="settings-appearance"
      subtitle="Light or dark, and how much fits on the screen."
    >
      <SettingsGroup label="Theme">
        <div role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <SettingsChoiceRow
              key={option.value}
              name="theme"
              value={option.value}
              checked={theme === option.value}
              label={option.label}
              description={option.description}
              onSelect={() => void setTheme(option.value)}
              testId={`theme-${option.value}`}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Density"
        footnote="Density changes row height and padding, not the size of the text you read."
      >
        <div role="radiogroup" aria-label="Density">
          {DENSITY_OPTIONS.map((option) => (
            <SettingsChoiceRow
              key={option.value}
              name="density"
              value={option.value}
              checked={density === option.value}
              label={option.label}
              description={option.description}
              onSelect={() => void setDensity(option.value)}
              testId={`density-${option.value}`}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup label="Sample">
        <div className="flex flex-col gap-[var(--space-1)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="text-[length:var(--text-lg)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-title)] text-[var(--color-text)]">
            Brent Hendrickson
          </div>
          <div className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Next step: call about the estimate, due tomorrow.
          </div>
        </div>
        <div className="flex min-h-[var(--row-h)] items-center border-t border-[var(--color-border)] px-[var(--space-4)] text-[length:var(--text-base)] text-[var(--color-text)]">
          A list row, at this theme and density.
        </div>
      </SettingsGroup>
    </SettingsScreenFrame>
  );
}
