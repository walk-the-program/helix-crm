import { describe, expect, it } from "vitest";
import {
  dropTargetIndex,
  findCard,
  isNoopMove,
  keyboardMove,
  moveCard,
  type BoardColumn,
} from "@/features/records/lib/board";

function board(): BoardColumn[] {
  return [
    { stageId: "new", dealIds: ["a", "b", "c"] },
    { stageId: "contacted", dealIds: ["d"] },
    { stageId: "won", dealIds: [] },
  ];
}

describe("findCard", () => {
  it("finds a card's column and index", () => {
    expect(findCard(board(), "b")).toEqual({ stageId: "new", index: 1 });
    expect(findCard(board(), "d")).toEqual({ stageId: "contacted", index: 0 });
  });

  it("returns null for a card that is not on the board", () => {
    expect(findCard(board(), "zzz")).toBeNull();
  });
});

describe("moveCard", () => {
  it("moves a card to another stage at the index asked for", () => {
    const next = moveCard(board(), "a", "contacted", 0);
    expect(next[0].dealIds).toEqual(["b", "c"]);
    expect(next[1].dealIds).toEqual(["a", "d"]);
  });

  it("appends when the index is past the end", () => {
    const next = moveCard(board(), "a", "won", 99);
    expect(next[2].dealIds).toEqual(["a"]);
  });

  it("moves down inside one column without landing a slot early", () => {
    // "a" (index 0) dropped on "c" (index 2) must end up last, not middle.
    const next = moveCard(board(), "a", "new", 2);
    expect(next[0].dealIds).toEqual(["b", "c", "a"]);
  });

  it("moves up inside one column", () => {
    const next = moveCard(board(), "c", "new", 0);
    expect(next[0].dealIds).toEqual(["c", "a", "b"]);
  });

  it("leaves the board alone for an unknown card or an unknown stage", () => {
    const start = board();
    expect(moveCard(start, "zzz", "new", 0)).toBe(start);
    expect(moveCard(start, "a", "nope", 0)).toBe(start);
  });

  it("never loses or duplicates a card", () => {
    const next = moveCard(board(), "b", "won", 0);
    const all = next.flatMap((column) => column.dealIds);
    expect(all.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("dropTargetIndex", () => {
  it("takes the index of the card it was dropped on", () => {
    expect(dropTargetIndex(board(), "d", "b", "new")).toBe(1);
  });

  it("appends when the over id is not a card in that column", () => {
    expect(dropTargetIndex(board(), "a", "nope", "contacted")).toBe(1);
  });

  it("returns 0 for a stage that is not on the board", () => {
    expect(dropTargetIndex(board(), "a", "b", "nope")).toBe(0);
  });
});

describe("keyboardMove", () => {
  it("shift+right moves to the next stage keeping the row where possible", () => {
    expect(keyboardMove(board(), "a", "right")).toEqual({
      dealId: "a",
      fromStageId: "new",
      fromIndex: 0,
      toStageId: "contacted",
      toIndex: 0,
    });
  });

  it("clamps the row when the next stage is shorter", () => {
    expect(keyboardMove(board(), "c", "right")?.toIndex).toBe(1);
  });

  it("shift+left moves back a stage", () => {
    expect(keyboardMove(board(), "d", "left")?.toStageId).toBe("new");
  });

  it("refuses to move off either end of the board", () => {
    expect(keyboardMove(board(), "a", "left")).toBeNull();
    expect(keyboardMove(board(), "d", "right")).not.toBeNull();
    const lastColumn = [{ stageId: "won", dealIds: ["x"] }];
    expect(keyboardMove(lastColumn, "x", "right")).toBeNull();
  });

  it("shift+down and shift+up move inside the stage", () => {
    expect(keyboardMove(board(), "a", "down")?.toIndex).toBe(1);
    expect(keyboardMove(board(), "c", "up")?.toIndex).toBe(1);
  });

  it("refuses to move past the top or bottom of a stage", () => {
    expect(keyboardMove(board(), "a", "up")).toBeNull();
    expect(keyboardMove(board(), "c", "down")).toBeNull();
  });

  it("returns null for a card that is not on the board", () => {
    expect(keyboardMove(board(), "zzz", "up")).toBeNull();
  });
});

describe("isNoopMove", () => {
  it("spots a move that changes nothing", () => {
    expect(
      isNoopMove({
        dealId: "a",
        fromStageId: "new",
        fromIndex: 1,
        toStageId: "new",
        toIndex: 1,
      }),
    ).toBe(true);
  });

  it("does not call a real move a no-op", () => {
    expect(
      isNoopMove({
        dealId: "a",
        fromStageId: "new",
        fromIndex: 1,
        toStageId: "won",
        toIndex: 1,
      }),
    ).toBe(false);
  });
});
