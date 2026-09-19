import { Loader2 } from "lucide-react";

/**
 * A spinner never stands in for a loading table — that gets a quiet row count
 * (docs/DESIGN.md section 8). Under prefers-reduced-motion it stops turning
 * and the status text carries the message.
 */
export function Spinner(props: { size?: number; label?: string }) {
  const { size = 20, label = "Loading" } = props;

  return (
    <span role="status" className="inline-flex flex-none items-center justify-center">
      <Loader2
        className="animate-spin motion-reduce:animate-none text-[var(--color-text-muted)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
