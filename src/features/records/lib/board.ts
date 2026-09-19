/**
 * The pipeline board's move arithmetic, kept pure so it can be unit-tested
 * without a database, a pointer or a React tree.
 *
 * A board is an ordered list of columns, each an ordered list of deal ids.
 * Every move answers the same question: which column does the card land in,
 * and at which index. The repository then persists `stage_id` and `position`.
 */

export type BoardColumn = { stageId: string; dealIds: string[] };

export type BoardMove = {
  dealId: string;
  fromStageId: string;
  fromIndex: number;
  toStageId: string;
  toIndex: number;
};

export function findCard(
  columns: BoardColumn[],
  dealId: string,
): { stageId: string; index: number } | null {
  for (const column of columns) {
    const index = column.dealIds.indexOf(dealId);
    if (index >= 0) return { stageId: column.stageId, index };
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Apply a move and return the new columns. The source card is removed first,
 * so a within-column move to a later index lands where the owner dropped it
 * rather than one slot early.
 */
export function moveCard(
  columns: BoardColumn[],
  dealId: string,
  toStageId: string,
  toIndex: number,
): BoardColumn[] {
  const from = findCard(columns, dealId);
  if (!from) return columns;
  if (!columns.some((column) => column.stageId === toStageId)) return columns;

  const without = columns.map((column) => ({
    stageId: column.stageId,
    dealIds: column.dealIds.filter((id) => id !== dealId),
  }));

  return without.map((column) => {
    if (column.stageId !== toStageId) return column;
    const index = clamp(toIndex, 0, column.dealIds.length);
    const dealIds = [...column.dealIds];
    dealIds.splice(index, 0, dealId);
    return { stageId: column.stageId, dealIds };
  });
}

/**
 * What a drop on another card means. dnd-kit hands us the card that was under
 * the pointer; dropping below its midpoint means "after it".
 */
export function dropTargetIndex(
  columns: BoardColumn[],
  activeId: string,
  overId: string,
  overStageId: string,
): number {
  const overColumn = columns.find((column) => column.stageId === overStageId);
  if (!overColumn) return 0;

  const overIndex = overColumn.dealIds.indexOf(overId);
  if (overIndex < 0) return overColumn.dealIds.length;

  const activeIndex = overColumn.dealIds.indexOf(activeId);
  // Within one column dnd-kit's indices already account for the gap the
  // dragged card leaves behind, so the over index is the destination.
  if (activeIndex >= 0) return overIndex;
  return overIndex;
}

/**
 * Keyboard moves: shift+left/right changes stage keeping the row, shift+up/down
 * changes position inside the stage. Returns null when the move runs off the
 * board, so the handler can leave the key to the browser.
 */
export function keyboardMove(
  columns: BoardColumn[],
  dealId: string,
  direction: "left" | "right" | "up" | "down",
): BoardMove | null {
  const from = findCard(columns, dealId);
  if (!from) return null;

  const columnIndex = columns.findIndex((column) => column.stageId === from.stageId);
  if (columnIndex < 0) return null;

  if (direction === "up" || direction === "down") {
    const delta = direction === "up" ? -1 : 1;
    const toIndex = from.index + delta;
    const size = columns[columnIndex].dealIds.length;
    if (toIndex < 0 || toIndex > size - 1) return null;
    return {
      dealId,
      fromStageId: from.stageId,
      fromIndex: from.index,
      toStageId: from.stageId,
      toIndex,
    };
  }

  const delta = direction === "left" ? -1 : 1;
  const targetColumn = columns[columnIndex + delta];
  if (!targetColumn) return null;
  return {
    dealId,
    fromStageId: from.stageId,
    fromIndex: from.index,
    toStageId: targetColumn.stageId,
    toIndex: clamp(from.index, 0, targetColumn.dealIds.length),
  };
}

/** A move that changes nothing needs no write and no toast. */
export function isNoopMove(move: BoardMove): boolean {
  return move.fromStageId === move.toStageId && move.fromIndex === move.toIndex;
}
