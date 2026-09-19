/**
 * "/settings/appearance" - theme and density. Both live in helix.json, not
 * the workspace database (src/app/appSettings.ts), and both apply live: no
 * Save button, the change is visible on <html> the instant it is picked.
 */
import { useAppearance } from "@/app/hooks";
import type { Density, Theme } from "@/app/appSettings";
import { SettingsScreenFrame } from "@/features/settings/components/SettingsLayout";

const THEME_OPTIONS: { value: Theme; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "The default. Easiest to read in daylight." },
  { value: "dark", label: "Dark", description: "Easier on the eyes late at night." },
  { value: "auto", label: "Auto", description: "Auto follows your Mac or Windows setting." },
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
    description: "Compact fits about a third more rows on a list. Text never gets smaller.",
  },
];

function OptionRow<T extends string>(props: {
  name: string;
  value: T;
  current: T;
  label: string;
  description: string;
  testId: string;
  onSelect: (value: T) => void;
}) {
  const { name, value, current, label, description, testId, onSelect } = props;
  const checked = current === value;

  return (
    <label
      className={[
        "flex min-h-[var(--control-h)] cursor-pointer items-start gap-[var(--space-3)]",
        "rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-3)]",
        "bg-[var(--color-surface)]",
        checked ? "border-[var(--color-border-strong)]" : "border-[var(--color-border)]",
      ].join(" ")}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        data-testid={testId}
        className={[
          "mt-[3px] h-[var(--space-4)] w-[var(--space-4)] shrink-0",
          // The accent means "this needs you" (DESIGN.md s5); a chosen radio is not
          // a signal, so the control paints in ink.
          "accent-[var(--color-text)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        ].join(" ")}
      />
      <span className="flex flex-col gap-[var(--space-1)]">
        <span className="text-[length:var(--text-base)] text-[var(--color-text)]">{label}</span>
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function AppearanceScreen() {
  const { theme, density, setTheme, setDensity } = useAppearance();

  return (
    <SettingsScreenFrame
      title="Appearance"
      testId="settings-appearance"
      subtitle="Light or dark, and how much fits on the screen."
    >
      <div className="flex max-w-[560px] flex-col gap-[var(--space-8)]">
        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="text-[length:var(--text-sm)] font-semibold text-[var(--color-text-muted)]">
            Theme
          </h2>
          <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-[var(--space-2)]">
            {THEME_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                name="theme"
                value={option.value}
                current={theme}
                label={option.label}
                description={option.description}
                testId={`theme-${option.value}`}
                onSelect={(value) => void setTheme(value)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="text-[length:var(--text-sm)] font-semibold text-[var(--color-text-muted)]">
            Density
          </h2>
          <div
            role="radiogroup"
            aria-label="Density"
            className="flex flex-col gap-[var(--space-2)]"
          >
            {DENSITY_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                name="density"
                value={option.value}
                current={density}
                label={option.label}
                description={option.description}
                testId={`density-${option.value}`}
                onSelect={(value) => void setDensity(value)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[var(--space-2)]">
          <h2 className="text-[length:var(--text-sm)] font-semibold text-[var(--color-text-muted)]">
            Preview
          </h2>
          <div className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]">
            <div className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
              Brent Hendrickson
            </div>
            <div className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Next step: Call about the estimate, due tomorrow.
            </div>
            <div className="flex min-h-[var(--row-h)] items-center border-t border-[var(--color-border)] px-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text)]">
              A sample row, at this theme and density.
            </div>
          </div>
        </div>
      </div>
    </SettingsScreenFrame>
  );
}
