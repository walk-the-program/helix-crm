/**
 * The lead-poll banner (docs/PLAN.md error map: LeadPollAuthError and
 * LeadPollNetworkError).
 *
 * It is deliberately a warning, not a danger: danger is reserved for
 * destructive actions and for things that actually failed on this machine. A
 * website that turned a token down, or a laptop that drove out of signal, is
 * the system's state, which is what warning means. Neither colour ever
 * appears without a word beside it, and the banner has square corners like
 * everything else on the screen.
 */
import { AlertTriangle } from "@/ui/icons";
import type { ReactNode } from "react";
import type { PollStatus } from "@/features/leads/lib/types";

export function PollBanner(props: {
  status: PollStatus;
  action?: ReactNode;
}): ReactNode {
  const { status, action } = props;
  if (!status.bannerVisible || !status.lastError) return null;

  const isAuth = status.lastError.kind === "auth";
  return (
    <div
      role="status"
      data-testid="lead-poll-banner"
      className={[
        "flex items-start gap-[var(--space-3)]",
        "border border-[var(--color-border)]",
        "bg-[var(--color-warning-soft)] px-[var(--space-4)] py-[var(--space-3)]",
      ].join(" ")}
    >
      <AlertTriangle
        size={18}
        weight="regular"
        className="mt-[var(--space-1)] shrink-0 text-[var(--color-warning-ink)]"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
          {isAuth
            ? "Your website turned the connection down. Check the token."
            : "Helix cannot reach your website."}
        </p>
        <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {isAuth
            ? "New leads are not coming in until the token is right. Paste a fresh one below and save."
            : `Nothing has come through for ${status.consecutiveFailures} tries. Helix keeps trying on its own.`}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
