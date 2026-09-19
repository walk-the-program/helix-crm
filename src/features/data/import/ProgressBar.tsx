/**
 * A labelled progress bar. Tokens only; no colour outside tokens.css.
 *
 * The track is the quiet neutral tint rather than the surface colour, which on
 * a white panel drew nothing at all, and the fill is the one near-black the
 * product uses for a filled control. While the row count is still unknown the
 * bar pulses at full width instead of sitting at 100%, which read as finished;
 * reduced motion holds it still and the label carries the count.
 */
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
        className="h-[var(--space-2)] w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-accent-soft)]"
      >
        <div
          className={[
            "h-full rounded-[var(--radius-full)] bg-[var(--color-accent)]",
            "transition-[width] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
            indeterminate ? "animate-pulse opacity-40 motion-reduce:animate-none" : "",
          ].join(" ")}
          style={{ width: indeterminate ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}
