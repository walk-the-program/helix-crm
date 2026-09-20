/**
 * The chrome the three setup screens share.
 *
 * On the first run this is the whole window: no sidebar, no toolbar, the Helix
 * lockup at the top and one column of content under it. The lockup is where the
 * screen spends `--shadow-sticker` (docs/DESIGN.md §6 allows exactly one hero
 * element per screen to wear it, and the brand saying who is talking is worth
 * more here than anywhere else), so nothing else in these screens carries it.
 *
 * Reopened from "/setup" the same screens render inside the shell, where the
 * sidebar already shows the lockup — so `chrome={false}` leaves it off and the
 * column keeps its width.
 */
import type { ReactNode } from "react";
import { Brand } from "@/ui";

export function StepLabel({ step, of = 3 }: { step: number; of?: number }) {
  return (
    <span className="section-label">
      Step {step} of {of}
    </span>
  );
}

/**
 * "Skip for now" — a link, not a button, because it is a way out rather than an
 * action, and it is on every screen so nobody is ever trapped in setup.
 */
export function SkipLink({ onSkip, busy }: { onSkip: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      disabled={busy}
      className={[
        "self-start text-[length:var(--text-sm)] text-[var(--color-link)] underline",
        "underline-offset-2 disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1",
      ].join(" ")}
    >
      Skip for now
    </button>
  );
}

export function OnboardingFrame({
  step,
  chrome = true,
  onSkip,
  busy,
  children,
}: {
  step: number;
  /** False inside the shell, where the sidebar already carries the lockup. */
  chrome?: boolean;
  onSkip: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-onboarding="frame"
      className={
        chrome
          ? "min-h-screen w-full overflow-y-auto bg-[var(--color-bg)]"
          : "w-full bg-[var(--color-bg)]"
      }
    >
      <div
        className={[
          "mx-auto flex w-full max-w-[720px] flex-col gap-[var(--space-6)]",
          chrome ? "px-[var(--space-8)] py-[var(--space-8)]" : "pb-[var(--space-8)]",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-[var(--space-4)]">
          {chrome ? <Brand size="lg" /> : <span />}
          <StepLabel step={step} />
        </div>
        {children}
        <SkipLink onSkip={onSkip} busy={busy} />
      </div>
    </div>
  );
}

/** A labelled group of rows in the canvas, the way a settings pane titles one. */
export function SetupSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[var(--space-2)]">
      <div className="flex flex-col gap-[var(--space-1)]">
        <div className="section-label">{label}</div>
        {hint ? (
          <p className="text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A square, hard-edged tile the owner picks from: the trade grid and the
 * three-word vocabulary choice. The selected one takes `--color-selected`, the
 * quiet tint, and never the primary block — that belongs to the one button on
 * the screen (docs/DESIGN.md §5).
 */
export function ChoiceTile({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        "flex min-h-[var(--row-h)] flex-col items-start justify-center gap-[var(--space-1)]",
        "border px-[var(--space-3)] py-[var(--space-2)] text-left",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1",
        selected
          ? "border-[var(--color-border-strong)] bg-[var(--color-selected)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-hover)]",
      ].join(" ")}
    >
      <span
        className={[
          "text-[length:var(--text-base)] leading-[var(--leading-normal)]",
          selected
            ? "font-medium text-[var(--color-text)]"
            : "text-[var(--color-text)]",
        ].join(" ")}
      >
        {label}
      </span>
      {hint ? (
        <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
