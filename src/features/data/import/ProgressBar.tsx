/** A labelled progress bar. Tokens only; no colour outside tokens.css. */
export function ProgressBar(props: {
  value: number;
  max: number;
  label: string;
  indeterminate?: boolean;
}) {
  const { value, max, label, indeterminate } = props;
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex items-baseline justify-between gap-[var(--space-3)]">
        <span className="text-[length:var(--text-sm)] text-[var(--color-text)]">{label}</span>
        <span className="text-[length:var(--text-sm)] tabular-nums text-[var(--color-text-muted)]">
          {indeterminate ? `${value.toLocaleString()} rows` : `${pct}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : value}
        className="h-[var(--space-2)] w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface)]"
      >
        <div
          className="h-full rounded-[var(--radius-full)] bg-[var(--color-accent)] transition-[width] duration-150"
          style={{ width: indeterminate ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}
