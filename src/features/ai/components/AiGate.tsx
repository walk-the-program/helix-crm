/**
 * The gate in front of every AI action.
 *
 * PLAN.md E1: "When AI is off or the key is missing or rejected, the buttons
 * stay visible but disabled, with a one-line reason and a link to settings."
 * Disabled, not hidden: a button that vanishes teaches the owner nothing, and a
 * feature he paid for should be visible even when it is not ready.
 *
 * A disabled button cannot be hovered for a tooltip in every browser, so the
 * reason is rendered as text beside it rather than hidden behind a hover.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { Button } from "@/ui";

export function AiReason(props: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
      {props.reason}{" "}
      <Link
        href="/settings/ai"
        className="text-[var(--color-accent-ink)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        Open AI settings
      </Link>
    </span>
  );
}

/**
 * A button that is disabled with a reason when AI is not ready, and does its
 * job when it is. Used by DraftFollowUpButton and SummarizeButton, and by the
 * Extract button inside the paste dialog.
 */
export function AiActionButton(props: {
  label: string;
  loadingLabel?: string;
  disabledReason: string | null;
  busy?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  testId?: string;
}) {
  const {
    label,
    loadingLabel,
    disabledReason,
    busy,
    onClick,
    icon,
    variant = "secondary",
    testId,
  } = props;

  return (
    <span className="inline-flex flex-wrap items-center gap-[var(--space-2)]">
      <Button
        variant={variant}
        onClick={onClick}
        disabled={disabledReason !== null}
        loading={busy}
        iconLeft={icon ?? <Sparkles size={16} aria-hidden />}
        data-testid={testId}
        aria-describedby={disabledReason ? `${testId ?? label}-reason` : undefined}
      >
        {busy && loadingLabel ? loadingLabel : label}
      </Button>
      {disabledReason ? (
        <span id={`${testId ?? label}-reason`} data-testid="ai-disabled-reason">
          <AiReason reason={disabledReason} />
        </span>
      ) : null}
    </span>
  );
}
