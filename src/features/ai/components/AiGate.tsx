/**
 * The gate in front of every AI action.
 *
 * What changed in the CPO pass (finding F-LC-20, Fable's ruling R16), and why.
 *
 * PLAN.md E1 said: "When AI is off or the key is missing or rejected, the
 * buttons stay visible but disabled, with a one-line reason and a link to
 * settings." That rule was written to stop AI being a silent no-op, and it
 * worked — but it conflated two states that deserve different answers, and the
 * walk showed what the conflation costs. An owner who will never turn AI on
 * was reading "AI is off. Turn it on in Settings. Open AI settings" on the
 * contact, company and deal page, on a product D2 says is not AI-first; and
 * the deal page, which has two AI buttons, needed a CSS hack to stop saying it
 * twice (DealPage.tsx's `[&>*:not(:first-child)_[data-testid=ai-disabled-
 * reason]]:hidden`, which shipped as a real rule in the stylesheet).
 *
 * So the two states are now separated:
 *
 * - **The module is off.** There is no control at all. A feature the owner has
 *   not switched on does not narrate its absence on every customer record.
 *   Settings > AI carries the one honest sentence about being off, which is
 *   where someone looking for the feature will go.
 * - **The module is on but the key is missing or rejected.** The button is
 *   visible and disabled, exactly as E1 asks, because now the owner HAS opted
 *   in and a silent absence really would be a mystery. The reason moves from a
 *   line of body text into the button's tooltip and its accessible
 *   description, so it is one hover or one screen reader away rather than
 *   printed on the page.
 *
 * A disabled `<button>` fires no pointer events, so the tooltip is attached to
 * a wrapper span rather than the button — the standard Radix pattern — and the
 * span is focusable when the button is not, so the keyboard reaches the
 * explanation too. `aria-describedby` points at a visually hidden copy of the
 * same sentence, so nothing depends on hover alone.
 *
 * `AiReason` is unchanged and still exported: the paste-to-record dialog opens
 * from a palette command, so it has to explain itself in prose — there is no
 * button to hang a tooltip on when the whole dialog is the thing that cannot
 * run.
 *
 * Consequence for the record pages (lead-records): nothing to pass, nothing to
 * arrange. The buttons disappear when the module is off, and the CSS hack that
 * hid the second reason has nothing left to hide and can go.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ICON_SIZE_SM, ICON_WEIGHT_STRONG, Sparkle } from "@/ui/icons";
import { Button, Tooltip } from "@/ui";
import { useAi } from "@/features/ai/lib/useAi";

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
 * A button that does its job when AI can run, disables itself with a reason in
 * a tooltip when the key is missing or rejected, and is not there at all when
 * the module is off.
 *
 * `disabledReason` still comes from the caller (it is `useAi().disabledReason`
 * at every call site) so the existing props are untouched; the module's on/off
 * state is read here rather than threaded through, because every caller would
 * otherwise have to remember to ask.
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
  /**
   * Render the reason as a visible line beside the button as well as in the
   * tooltip. Off by default: two buttons in one cluster would print it twice,
   * which is the thing this change exists to stop. The paste dialog, which
   * owns its whole surface, passes true.
   */
  showReasonLine?: boolean;
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
    showReasonLine = false,
  } = props;

  const { config, loading } = useAi();

  // Off, or not yet known. Rendering nothing while the config loads avoids a
  // button that appears and then vanishes on a workspace where AI is off,
  // which is most of them.
  if (loading || config === null || !config.enabled) return null;

  const reasonId = disabledReason ? `${testId ?? label}-reason` : undefined;

  const button = (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabledReason !== null}
      loading={busy}
      iconLeft={icon ?? <Sparkle size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
      data-testid={testId}
      aria-describedby={reasonId}
    >
      {busy && loadingLabel ? loadingLabel : label}
    </Button>
  );

  if (!disabledReason) {
    return <span className="inline-flex flex-wrap items-center gap-[var(--space-2)]">{button}</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-[var(--space-2)]">
      {/*
        The tooltip hangs on this span, not on the button: a disabled button
        emits no pointer events, so Radix would never see the hover. tabIndex=0
        puts it in the tab order in the button's place, so the keyboard gets
        the same explanation the mouse does.
      */}
      <Tooltip content={`${disabledReason} Open Settings > AI.`}>
        <span tabIndex={0} className="inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
          {button}
        </span>
      </Tooltip>
      {/*
        The same sentence, for a screen reader, whether or not the tooltip is
        open. `sr-only` rather than `hidden`: aria-describedby does not resolve
        to display:none content.
      */}
      <span id={reasonId} data-testid="ai-disabled-reason" className={showReasonLine ? undefined : "sr-only"}>
        {showReasonLine ? <AiReason reason={disabledReason} /> : disabledReason}
      </span>
    </span>
  );
}
