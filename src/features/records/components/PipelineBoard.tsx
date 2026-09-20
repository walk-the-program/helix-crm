/**
 * The pipeline board.
 *
 * Drag between and within stages with dnd-kit, and move without a mouse with
 * shift+arrow. Both paths end in the same place: `boardLib.moveCard` works out
 * the new column and index, the board renders that optimistically, and
 * `deals.moveTo` persists stage and position.
 *
 * A drop on a won or lost column does not move anything by itself: it opens
 * StageMoveDialog ("Move to <Stage>?") and waits for Confirm, which supplies
 * the date (and, for lost, the reason) that `deals.moveTo` needs. Any other
 * drop - between two open stages, or a reorder within one - lands right away
 * with today's date, the way it always has (D24).
 */
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation } from "wouter";
import type { Deal } from "@/db/repos/deals";
import type { Stage } from "@/db/repos/stages";
import * as dealsRepo from "@/db/repos/deals";
import { formatMoneyTrim, formatMonthly } from "@/lib/money";
import * as dealItemsRepo from "@/db/repos/dealItems";
import { upfrontCents } from "@/db/repos/dealItems";
import { DealCard } from "@/features/records/components/DealCard";
import { StageMoveDialog } from "@/features/records/components/StageMoveDialog";
import {
  moveCard,
  keyboardMove,
  isNoopMove,
  findCard,
  type BoardColumn,
} from "@/features/records/lib/board";
import {
  invalidateRecords,
  reportError,
  writeWithUndo,
} from "@/features/records/lib/mutations";

export type PipelineBoardProps = {
  stages: Stage[];
  board: { stageId: string; deals: Deal[] }[];
  nextStepByDealId: Map<string, string>;
};

export function PipelineBoard({ stages, board, nextStepByDealId }: PipelineBoardProps) {
  const [, navigate] = useLocation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    dealId: string;
    stageId: string;
    index: number;
    stageName: string;
    requiresReason: boolean;
    initialReason: string | null;
    /** Run once the move actually lands, e.g. to refocus after shift+arrow. */
    afterCommit?: () => void;
  } | null>(null);

  const dealsById = useMemo(() => {
    const map = new Map<string, Deal>();
    for (const column of board) for (const deal of column.deals) map.set(deal.id, deal);
    return map;
  }, [board]);

  /**
   * The columns the board draws: every live stage in pipeline order, then any
   * stage the board reports that the stage list no longer has a row for.
   *
   * `deals.board()` deliberately keeps a deal whose stage was deleted
   * underneath it (docs/CONTRACTS.md, "deals.board()"), but this component used
   * to build its columns from `stages` alone, so that entry was dropped on the
   * floor: the cards vanished from the board while the header total still
   * counted them - $53,200 of invisible pipeline in the audit's fixture (CPO
   * audit, F-LA-18). Those deals get one unnamed column at the end, which is
   * also the drop target the owner needs to drag them back out of.
   */
  const orphanStageIds = useMemo(() => {
    const known = new Set(stages.map((stage) => stage.id));
    return board
      .filter((column) => !known.has(column.stageId) && column.deals.length > 0)
      .map((column) => column.stageId);
  }, [stages, board]);

  const serverColumns: BoardColumn[] = useMemo(() => {
    const dealIdsByStage = new Map(
      board.map((column) => [column.stageId, column.deals.map((deal) => deal.id)]),
    );
    return [...stages.map((stage) => stage.id), ...orphanStageIds].map((stageId) => ({
      stageId,
      dealIds: dealIdsByStage.get(stageId) ?? [],
    }));
  }, [stages, board, orphanStageIds]);

  // Optimistic copy: the board redraws the moment the card lands, and the
  // refetch after the write replaces it.
  const [columns, setColumns] = useState<BoardColumn[]>(serverColumns);
  useEffect(() => setColumns(serverColumns), [serverColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persist(
    dealId: string,
    stageId: string,
    index: number,
    options?: { at?: string; outcomeReason?: string | null },
  ) {
    try {
      // The move carries a batch id so it lands on the application undo stack.
      // Before the HIG pass it carried none, which is why a drag was the one
      // change in the product that could not be taken back at all
      // (design/apple-hig-review.md, findings 3 and 17).
      const title = dealsById.get(dealId)?.title ?? "that card";
      const toStage = stages.find((candidate) => candidate.id === stageId);
      await writeWithUndo({
        label: `moved ${title} to ${toStage?.name ?? "another stage"}`,
        write: (batchId) =>
          dealsRepo
            .moveTo(dealId, stageId, index, {
              outcomeReason: options?.outcomeReason,
              at: options?.at,
              batchId,
            })
            .then(() => undefined),
      });
      // Dropping a card on the Won column is one of the two ways a deal is
      // won, so it starts the recurring clock the same way the deal page's
      // stage picker does (D20).
      await dealItemsRepo.recompute(dealId);
      await invalidateRecords();
    } catch (err) {
      setColumns(serverColumns);
      reportError(err, "That move did not save.");
    }
  }

  /**
   * Route a move: a won/lost target asks StageMoveDialog for a date (and, for
   * lost, a reason) and touches nothing until Confirm - cancelling leaves the
   * card exactly where it was, because `columns` never changed. Anything else
   * applies right away with today's date, as it always has.
   */
  function apply(
    dealId: string,
    toStageId: string,
    toIndex: number,
    afterCommit?: () => void,
  ) {
    const before = findCard(columns, dealId);
    if (!before) return;
    if (before.stageId === toStageId && before.index === toIndex) return;

    // Only an actual stage change is a "move to won/lost" - reordering cards
    // that are already sitting in one needs no date and no reason.
    const changingStage = before.stageId !== toStageId;
    const target = stages.find((candidate) => candidate.id === toStageId);
    if (changingStage && target && (target.isWon || target.isLost)) {
      const deal = dealsById.get(dealId);
      setPendingMove({
        dealId,
        stageId: toStageId,
        index: toIndex,
        stageName: target.name,
        requiresReason: target.isLost,
        initialReason: deal?.outcomeReason ?? null,
        afterCommit,
      });
      return;
    }

    setColumns((current) => moveCard(current, dealId, toStageId, toIndex));
    void persist(dealId, toStageId, toIndex);
    afterCommit?.();
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    const overId = String(over.id);

    // Dropped on a column body: append to the end of that stage.
    const overColumn = columns.find((column) => column.stageId === overId);
    if (overColumn) {
      apply(dealId, overColumn.stageId, overColumn.dealIds.length);
      return;
    }

    // Dropped on another card: take that card's slot.
    const target = findCard(columns, overId);
    if (!target) return;
    apply(dealId, target.stageId, target.index);
  }

  function onKeyMove(dealId: string, direction: "left" | "right" | "up" | "down") {
    const move = keyboardMove(columns, dealId, direction);
    if (!move || isNoopMove(move)) return;
    // Keep the moved card focused so a run of shift+arrows works. Deferred
    // until the move actually commits, since a won/lost target waits on
    // StageMoveDialog first and the card has not moved yet.
    apply(dealId, move.toStageId, move.toIndex, () => {
      window.requestAnimationFrame(() => {
        const node = document.querySelector<HTMLElement>(`[data-deal-id="${dealId}"]`);
        node?.focus();
      });
    });
  }

  const activeDeal = activeId ? dealsById.get(activeId) ?? null : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-h-0 flex-1 gap-[var(--space-6)] overflow-x-auto pb-[var(--space-4)]">
          {columns.map((column) => {
            const stage =
              stages.find((candidate) => candidate.id === column.stageId) ??
              orphanStage(column.stageId);
            const deals = column.dealIds
              .map((id) => dealsById.get(id))
              .filter((deal): deal is Deal => deal !== undefined);
            return (
              <StageColumn
                key={column.stageId}
                stage={stage}
                deals={deals}
                nextStepByDealId={nextStepByDealId}
                onOpen={(dealId) => navigate(`/deals/${dealId}`)}
                onKeyMove={onKeyMove}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeDeal ? (
            <DealCard
              deal={activeDeal}
              nextStep={nextStepByDealId.get(activeDeal.id) ?? null}
              dragging
              onOpen={() => undefined}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <StageMoveDialog
        open={pendingMove !== null}
        stageName={pendingMove?.stageName ?? ""}
        requiresReason={pendingMove?.requiresReason ?? false}
        initialReason={pendingMove?.initialReason ?? null}
        onOpenChange={(open) => {
          if (!open) setPendingMove(null);
        }}
        onConfirm={async ({ at, outcomeReason }) => {
          const pending = pendingMove;
          setPendingMove(null);
          if (!pending) return;
          setColumns((current) =>
            moveCard(current, pending.dealId, pending.stageId, pending.index),
          );
          await persist(pending.dealId, pending.stageId, pending.index, { at, outcomeReason });
          pending.afterCommit?.();
        }}
      />
    </>
  );
}

/**
 * The stand-in header for a stage that no longer exists. No colour: a dot in
 * the brand palette would make a broken column look like a deliberate one.
 */
function orphanStage(stageId: string): Stage {
  return {
    id: stageId,
    pipelineId: "",
    name: "Unassigned stage",
    color: "transparent",
    position: Number.MAX_SAFE_INTEGER,
    quietDays: 0,
    isWon: false,
    isLost: false,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

function StageColumn(props: {
  stage: Stage;
  deals: Deal[];
  nextStepByDealId: Map<string, string>;
  onOpen: (dealId: string) => void;
  onKeyMove: (dealId: string, direction: "left" | "right" | "up" | "down") => void;
}) {
  const { stage, deals, nextStepByDealId, onOpen, onKeyMove } = props;
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // Two numbers, because a column holding one patio and one maintenance
  // contract is not the same column as one holding two patios (D20).
  const upfront = deals.reduce((sum, deal) => sum + upfrontCents(deal), 0);
  const monthly = deals.reduce((sum, deal) => sum + deal.recurringMonthlyCents, 0);
  const currency = deals[0]?.currency ?? "USD";

  return (
    <section
      aria-label={stage.name}
      data-stage-id={stage.id}
      className="flex w-[280px] flex-none flex-col"
    >
      {/* No border and no fill: a coloured or boxed column is the loudest tell
          of a web kanban. The stage is named, dotted in its own colour, and
          separated from its cards by one hairline (DESIGN.md §5, §6). */}
      <header className="flex flex-col gap-[var(--space-1)] border-b border-[var(--color-border)] px-[var(--space-1)] pb-[var(--space-2)]">
        <div className="flex items-baseline gap-[var(--space-2)]">
          <span
            className="h-[7px] w-[7px] flex-none translate-y-[-1px]"
            style={{ background: stage.color }}
            aria-hidden="true"
          />
          <h2
            className="min-w-0 flex-1 truncate font-[family-name:var(--font-heading)] text-[length:var(--text-base)] font-semibold leading-[var(--leading-tight)] text-[var(--color-heading)]"
            title={stage.name}
          >
            {stage.name}
          </h2>
          <span className="tabular flex-none text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {deals.length}
          </span>
        </div>
        <div
          data-testid="stage-total"
          className="money text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
        >
          {monthly > 0 ? "Upfront " : null}
          {formatMoneyTrim(upfront, currency)}
          {monthly > 0 ? ` \u00b7 ${formatMonthly(monthly, currency)}` : null}
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={[
          "flex min-h-[120px] flex-1 flex-col gap-[var(--space-2)]",
          "p-[var(--space-2)]",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
          isOver ? "bg-[var(--color-selected)]" : "",
        ].join(" ")}
      >
        <SortableContext
          items={deals.map((deal) => deal.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((deal) => (
            <SortableDealCard
              key={deal.id}
              deal={deal}
              nextStep={nextStepByDealId.get(deal.id) ?? null}
              onOpen={() => onOpen(deal.id)}
              onKeyMove={(direction) => onKeyMove(deal.id, direction)}
            />
          ))}
        </SortableContext>

        {deals.length === 0 ? (
          <p className="px-[var(--space-2)] py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
            Nothing in {stage.name}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SortableDealCard(props: {
  deal: Deal;
  nextStep: string | null;
  onOpen: () => void;
  onKeyMove: (direction: "left" | "right" | "up" | "down") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.deal.id,
  });

  return (
    <DealCard
      ref={setNodeRef}
      deal={props.deal}
      nextStep={props.nextStep}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onOpen={props.onOpen}
      onKeyMove={props.onKeyMove}
      handleProps={{ ...attributes, ...listeners }}
    />
  );
}
