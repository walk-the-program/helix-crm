/**
 * The lead-poll banner (docs/PLAN.md error map, widened by LR-REV).
 *
 * The words are not here: `lib/pollMessages.ts` owns every string the owner
 * reads about a failed poll, so this banner, Today's one-liner and Settings'
 * "Last result" row cannot drift apart from each other or from
 * docs/OPERATIONS.md procedure 3.
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
import { shouldSuggestDisconnect } from "@/features/leads/lib/backoff";
import {
  pollBannerCopy,
  type PollFailureKind,
} from "@/features/leads/lib/pollMessages";
import type { PollStatus } from "@/features/leads/lib/types";

export function PollBanner(props: {
  status: PollStatus;
  action?: ReactNode;
}): ReactNode {
  const { status, action } = props;
  if (!status.bannerVisible || !status.lastError) return null;

  const copy = pollBannerCopy(status.lastError.kind as PollFailureKind, {
    status: status.lastError.status ?? null,
    consecutiveFailures: status.consecutiveFailures,
    suggestDisconnect: shouldSuggestDisconnect(status.consecutiveFailures),
    detail: status.lastError.detail ?? null,
  });
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
          {copy.headline}
        </p>
        <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {copy.detail}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
