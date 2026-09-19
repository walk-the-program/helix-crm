import { CircleNotch } from "@/ui/icons";

/**
 * A spinner never stands in for a loading table — that gets a quiet row count
 * (docs/DESIGN.md section 8). Under prefers-reduced-motion it stops turning
 * and the status text carries the message.
 */
export function Spinner(props: { size?: number; label?: string }) {
  const { size = 20, label = "Loading" } = props;

  return (
    <span role="status" className="inline-flex flex-none items-center justify-center">
      <CircleNotch
        size={size}
        weight="bold"
        className="animate-spin motion-reduce:animate-none text-[var(--color-text-muted)]"
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
