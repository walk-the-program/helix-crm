/**
 * The application undo stack: the bookkeeping, not the SQL.
 *
 * `tests/repo/records/undoRedo.test.ts` proves the replay itself against a real
 * database. This file proves what the stack does around it — the order, the
 * cap, the redo branch being abandoned by a new write, the toast wording, and
 * the thing that is easy to get wrong: a failed reversal has to put the entry
 * back, or Cmd+Z quietly eats a change it did not undo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const undoBatch = vi.fn<(batchId: string) => Promise<void>>();
const redoBatch = vi.fn<(batchId: string) => Promise<void>>();
const invalidateQueries = vi.fn<() => Promise<void>>();
const success = vi.fn<(msg: string) => void>();
const info = vi.fn<(msg: string) => void>();
const error = vi.fn<(msg: string) => void>();

vi.mock("@/db/changeLog", () => ({
  undoBatch: (batchId: string) => undoBatch(batchId),
  redoBatch: (batchId: string) => redoBatch(batchId),
}));

vi.mock("@/app/queryClient", () => ({
  queryClient: { invalidateQueries: () => invalidateQueries() },
}));

vi.mock("@/ui/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    info: (msg: string) => info(msg),
    error: (msg: string) => error(msg),
  },
}));

import {
  __resetUndoForTests,
  canRedo,
  canUndo,
  peekUndo,
  pushUndo,
  redo,
  undo,
  clearUndoHistory,
  undoCommands,
  UNDO_LIMIT,
} from "@/app/undo";

beforeEach(() => {
  __resetUndoForTests();
  undoBatch.mockReset().mockResolvedValue(undefined);
  redoBatch.mockReset().mockResolvedValue(undefined);
  invalidateQueries.mockReset().mockResolvedValue(undefined);
  success.mockReset();
  info.mockReset();
  error.mockReset();
});

afterEach(() => {
  __resetUndoForTests();
});

describe("the stack", () => {
  it("starts empty and offers nothing", () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    expect(peekUndo()).toBeNull();
  });

  it("undoes the newest write first", async () => {
    pushUndo({ batchId: "one", label: "added Priya" });
    pushUndo({ batchId: "two", label: "moved Retaining wall to Quoted" });

    await undo();

    expect(undoBatch).toHaveBeenCalledWith("two");
    expect(peekUndo()?.batchId).toBe("one");
  });

  it("names what happened in the toast", async () => {
    pushUndo({ batchId: "b", label: "moved Retaining wall to Quoted" });
    await undo();
    expect(success).toHaveBeenCalledWith("Undone: moved Retaining wall to Quoted");

    await redo();
    expect(success).toHaveBeenCalledWith("Redone: moved Retaining wall to Quoted");
  });

  it("refreshes what is on screen after a reversal", async () => {
    pushUndo({ batchId: "b", label: "edited Priya Raghunathan" });
    await undo();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("says so rather than throwing when there is nothing to undo", async () => {
    await undo();
    expect(undoBatch).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("Nothing to undo");

    await redo();
    expect(redoBatch).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("Nothing to redo");
  });

  it("holds twenty entries and drops the oldest", () => {
    for (let i = 0; i < UNDO_LIMIT + 5; i += 1) {
      pushUndo({ batchId: `b${i}`, label: `edit ${i}` });
    }
    expect(peekUndo()?.batchId).toBe(`b${UNDO_LIMIT + 4}`);
  });

  it("is emptied when a different workspace opens", () => {
    pushUndo({ batchId: "b", label: "added Priya" });
    clearUndoHistory();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});

describe("redo", () => {
  it("re-applies the batch the last undo reversed", async () => {
    pushUndo({ batchId: "b", label: "deleted Priya" });
    await undo();
    expect(canRedo()).toBe(true);

    await redo();

    expect(redoBatch).toHaveBeenCalledWith("b");
    expect(canRedo()).toBe(false);
    expect(peekUndo()?.batchId).toBe("b");
  });

  it("is abandoned by a new write, because there is one history and not a tree", async () => {
    pushUndo({ batchId: "b", label: "deleted Priya" });
    await undo();
    expect(canRedo()).toBe(true);

    pushUndo({ batchId: "c", label: "added Marisol" });

    expect(canRedo()).toBe(false);
  });
});

describe("when the replay fails", () => {
  it("puts the entry back so the owner can try again, and says why", async () => {
    undoBatch.mockRejectedValueOnce(new Error("The database is closed."));
    pushUndo({ batchId: "b", label: "moved Retaining wall to Quoted" });

    await undo();

    expect(peekUndo()?.batchId).toBe("b");
    expect(canRedo()).toBe(false);
    expect(error).toHaveBeenCalledWith("The database is closed.");
  });

  it("does the same on a failed redo", async () => {
    pushUndo({ batchId: "b", label: "deleted Priya" });
    await undo();
    redoBatch.mockRejectedValueOnce(new Error("nope"));

    await redo();

    expect(canRedo()).toBe(true);
    expect(peekUndo()).toBeNull();
  });
});

describe("the commands the shell binds", () => {
  it("are undo on mod+z and redo on shift", () => {
    expect(undoCommands.map((command) => command.id)).toEqual(["undo", "redo"]);
    expect(undoCommands[0].shortcut).toBe("mod+z");
    expect(undoCommands[1].shortcut).toBe("mod+shift+z");
  });

  it("do not opt in to running while the owner is typing", () => {
    // This is what leaves Cmd+Z to the text field: the shell's binder skips a
    // command on a typing target unless it asks for the opposite.
    for (const command of undoCommands) {
      expect(command.whileTyping).toBeUndefined();
    }
  });
});
