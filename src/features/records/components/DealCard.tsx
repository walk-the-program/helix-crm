/**
 * A card on the pipeline board. Four things and no more (DESIGN.md §3): the
 * title, the company, the value, and the next step. A card with no next step
 * says so in the accent — the only nag in the product.
 *
 * Keyboard: the card is focusable and shift+arrow moves it. dnd-kit's own
 * keyboard sensor also works through the drag handle, but shift+arrow is the
 * documented move and needs no drag mode.
 */
import { forwardRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { Deal } from "@/db/repos/deals";

export type DealCardProps = {
  deal: Deal;
  nextStep: string | null;
  dragging?: boolean;
  style?: CSSProperties;
  onOpen: () => void;
  onKeyMove?: (direction: "left" | "right" | "up" | "down") => void;
  /** dnd-kit listeners and attributes, spread onto the drag handle. */
  handleProps?: Record<string, unknown>;
};

export const DealCard = forwardRef<HTMLDivElement, DealCardProps>(function DealCard(
  { deal, nextStep, dragging, style, onOpen, onKeyMove, handleProps },
  ref,
) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
      return;
    }
    if (!event.shiftKey || !onKeyMove) return;
    const map: Record<string, "left" | "right" | "up" | "down"> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    const direction = map[event.key];
    if (!direction) return;
    event.preventDefault();
    onKeyMove(direction);
  }

  return (
    <div
      ref={ref}
      style={style}
      data-testid="deal-card"
      data-deal-id={deal.id}
      tabIndex={0}
      role="button"
      aria-label={`${deal.title}. Shift with an arrow key moves it.`}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={[
        "flex w-full cursor-pointer gap-[var(--space-2)]",
        "rounded-[var(--radius-md)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)] p-[var(--space-4)] shadow-[var(--shadow-sm)]",
        dragging ? "opacity-60 shadow-[var(--shadow-md)]" : "",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
      ].join(" ")}
    >
      <span
        {...handleProps}
        aria-label={`Drag ${deal.title}`}
        className="mt-[2px] shrink-0 cursor-grab text-[var(--color-text-faint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={16} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
          title={deal.title}
        >
          {deal.title}
        </div>
        <div
          className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          title={deal.companyName ?? ""}
        >
          {deal.companyName ?? "No company"}
        </div>
        <div className="mt-[var(--space-2)] flex items-baseline justify-between gap-[var(--space-2)]">
          <span className="money text-[length:var(--text-lg)] font-medium text-[var(--color-text)]">
            {formatMoney(deal.valueCents, deal.currency)}
          </span>
        </div>
        <div className="mt-[var(--space-1)] truncate text-[length:var(--text-xs)]">
          {nextStep ? (
            <span className="tabular text-[var(--color-text-muted)]" title={nextStep}>
              {nextStep}
            </span>
          ) : (
            <span className="font-medium text-[var(--color-accent-ink)]">No next step</span>
          )}
        </div>
      </div>
    </div>
  );
});
