/**
 * The pipeline board.
 *
 * Drag between and within stages with dnd-kit, and move without a mouse with
 * shift+arrow. Both paths end in the same place: `boardLib.moveCard` works out
 * the new column and index, the board renders that optimistically, and
 * `deals.moveTo` persists stage and position.
 *
 * Moving into a "lost" stage is refused by the repository until there is a
 * reason, so the board catches that and asks for one.
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
import { formatMoney } from "@/lib/money";
import { DealCard } from "@/features/records/components/DealCard";
import { LostReasonDialog } from "@/features/records/components/LostReasonDialog";
import {
  moveCard,
  keyboardMove,
  isNoopMove,
  findCard,
  type BoardColumn,
} from "@/features/records/lib/board";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

export type PipelineBoardProps = {
  stages: Stage[];
  board: { stageId: string; deals: Deal[] }[];
  nextStepByDealId: Map<string, string>;
};

export function PipelineBoard({ stages, board, nextStepByDealId }: PipelineBoardProps) {
  const [, navigate] = useLocation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{
    dealId: string;
    stageId: string;
    index: number;
  } | null>(null);

  const dealsById = useMemo(() => {
    const map = new Map<string, Deal>();
    for (const column of board) for (const deal of column.deals) map.set(deal.id, deal);
    return map;
  }, [board]);

  // `deals.board()` already returns one entry per stage in position order
  // (empty ones included), so the columns are its shape, not the stage list's.
  // `stages` is still what the headers render from, and a stage the board has
  // not heard of yet - one added in another window - gets an empty column.
  const serverColumns: BoardColumn[] = useMemo(() => {
    const dealIdsByStage = new Map(
      board.map((column) => [column.stageId, column.deals.map((deal) => deal.id)]),
    );
    return stages.map((stage) => ({
      stageId: stage.id,
      dealIds: dealIdsByStage.get(stage.id) ?? [],
    }));
  }, [stages, board]);

  // Optimistic copy: the board redraws the moment the card lands, and the
  // refetch after the write replaces it.
  const [columns, setColumns] = useState<BoardColumn[]>(serverColumns);
  useEffect(() => setColumns(serverColumns), [serverColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persist(dealId: string, stageId: string, index: number, reason?: string) {
    try {
      await dealsRepo.moveTo(dealId, stageId, index, {
        outcomeReason: reason,
      });
      await invalidateRecords();
    } catch (err) {
      const stage = stages.find((candidate) => candidate.id === stageId);
      if (stage?.isLost && reason === undefined) {
        setPendingLost({ dealId, stageId, index });
        setColumns(serverColumns);
        return;
      }
      setColumns(serverColumns);
      reportError(err, "That move did not save.");
    }
  }

  function apply(dealId: string, toStageId: string, toIndex: number) {
    const before = findCard(columns, dealId);
    if (!before) return;
    if (before.stageId === toStageId && before.index === toIndex) return;
    setColumns((current) => moveCard(current, dealId, toStageId, toIndex));
    void persist(dealId, toStageId, toIndex);
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
    setColumns((current) => moveCard(current, dealId, move.toStageId, move.toIndex));
    void persist(dealId, move.toStageId, move.toIndex);
    // Keep the moved card focused so a run of shift+arrows works.
    window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-deal-id="${dealId}"]`);
      node?.focus();
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
        <div className="flex min-h-0 flex-1 gap-[var(--space-4)] overflow-x-auto pb-[var(--space-4)]">
          {stages.map((stage) => {
            const column = columns.find((candidate) => candidate.stageId === stage.id);
            const deals = (column?.dealIds ?? [])
              .map((id) => dealsById.get(id))
              .filter((deal): deal is Deal => deal !== undefined);
            return (
              <StageColumn
                key={stage.id}
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

      <LostReasonDialog
        open={pendingLost !== null}
        dealTitle={pendingLost ? dealsById.get(pendingLost.dealId)?.title ?? "" : ""}
        onOpenChange={(open) => {
          if (!open) setPendingLost(null);
        }}
        onConfirm={async (reason) => {
          const pending = pendingLost;
          setPendingLost(null);
          if (!pending) return;
          setColumns((current) =>
            moveCard(current, pending.dealId, pending.stageId, pending.index),
          );
          await persist(pending.dealId, pending.stageId, pending.index, reason);
        }}
      />
    </>
  );
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
  const total = deals.reduce((sum, deal) => sum + deal.valueCents, 0);
  const currency = deals[0]?.currency ?? "USD";

  return (
    <section
      aria-label={stage.name}
      data-stage-id={stage.id}
      className="flex w-[300px] shrink-0 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      <header className="flex flex-col gap-[var(--space-1)] border-b border-[var(--color-border)] p-[var(--space-4)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <span
            className="h-[var(--space-2)] w-[var(--space-2)] shrink-0 rounded-[var(--radius-full)]"
            style={{ background: stage.color }}
            aria-hidden="true"
          />
          <h2
            className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]"
            title={stage.name}
          >
            {stage.name}
          </h2>
          <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {deals.length}
          </span>
        </div>
        <div className="money text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
          {formatMoney(total, currency)}
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={[
          "flex min-h-[120px] flex-1 flex-col gap-[var(--space-3)] p-[var(--space-3)]",
          isOver ? "outline outline-2 outline-[var(--color-focus)]" : "",
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
          <p className="px-[var(--space-2)] py-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing in {stage.name}. Drag a card here, or press shift and an arrow on one.
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
