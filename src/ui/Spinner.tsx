import { Loader2 } from "lucide-react";

export function Spinner(props: { size?: number; label?: string }) {
  const { size = 20, label = "Loading" } = props;

  return (
    <span role="status" className="inline-flex items-center justify-center">
      <Loader2
        className="animate-spin text-[var(--color-text-muted)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
