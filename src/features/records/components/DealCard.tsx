/**
 * A card on the pipeline board. Four things and no more (DESIGN.md §3): the
 * title, the company, the value, and the next step.
 *
 * It is a hairline card and nothing else — `--radius-lg` because it contains
 * things, one hairline, no shadow. Only a floating layer casts a shadow, which
 * on this board is the drag overlay, and `dragging` is what turns that on.
 *
 * A card with no next step says so in tertiary ink, in a sentence. The old
 * version said it in the accent colour, which made a board of ordinary deals
 * read as a board of errors — the accent in this product is the fill of one
 * button and nothing else (DESIGN.md §5).
 *
 * Keyboard: the card is focusable and shift+arrow moves it. dnd-kit's own
 * keyboard sensor also works through the drag handle, but shift+arrow is the
 * documented move and needs no drag mode. The handle is faint until the card is
 * hovered or holds focus, so a full column reads as text rather than as a row
 * of grip glyphs.
 */
import { forwardRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { DotsSixVertical } from "@/ui/icons";
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
        "group flex w-full cursor-default gap-[var(--space-2)]",
        "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-3)]",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
        dragging
          ? "opacity-90 shadow-[var(--shadow-md)]"
          : "hover:bg-[var(--color-hover)]",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)]"
          title={deal.title}
        >
          {deal.title}
        </div>

        <div className="mt-[var(--space-1)] flex items-baseline gap-[var(--space-2)]">
          <span
            className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            title={deal.companyName ?? ""}
          >
            {deal.companyName ?? "No company"}
          </span>
          <span className="money flex-none text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
            {formatMoney(deal.valueCents, deal.currency)}
          </span>
        </div>

        <div className="mt-[var(--space-2)] truncate text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {nextStep ? (
            <span className="tabular" title={nextStep}>
              {nextStep}
            </span>
          ) : (
            <span>No next step</span>
          )}
        </div>
      </div>

      <span
        {...handleProps}
        aria-label={`Drag ${deal.title}`}
        className={[
          "flex-none cursor-grab self-start text-[var(--color-text-disabled)]",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
          "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <DotsSixVertical size={18} weight="regular" aria-hidden="true" />
      </span>
    </div>
  );
});
