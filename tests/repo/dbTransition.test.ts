/**
 * Work item 6: the workspace-switch note.
 *
 * `beginDbTransition`/`dbTransitionLabel` live in src/db/client.ts beside
 * `raw`, which is what lets `raw.close()` mark an implicit transition itself
 * (see that file's own comment on "the closed window"). `writeState.transition`
 * (src/db/writeLock.ts) mirrors the same label for the shell's top bar, kept
 * in sync by a `subscribeDbState` subscription made once at module load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginDbTransition,
  dbTransitionLabel,
  raw,
  __resetDbTransitionForTests,
} from "../../src/db/client";
import {
  getWriteStateSnapshot,
  subscribeWriteState,
  __resetWriteLockForTests,
} from "../../src/db/writeLock";
import { createHarness, type Harness } from "./harness";

let h: Harness | null = null;

beforeEach(() => {
  __resetWriteLockForTests();
  __resetDbTransitionForTests();
});

afterEach(() => {
  h?.dispose();
  h = null;
  __resetWriteLockForTests();
  __resetDbTransitionForTests();
});

describe("dbTransitionLabel / beginDbTransition", () => {
  it("is null at rest", () => {
    expect(dbTransitionLabel()).toBeNull();
  });

  it("returns the label while a transition is in flight, mirrored onto the write state, and notifies subscribeWriteState", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWriteState(listener);

    const end = beginDbTransition("Switching workspace…");

    expect(dbTransitionLabel()).toBe("Switching workspace…");
    expect(getWriteStateSnapshot().transition).toBe("Switching workspace…");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    end();
  });

  it("the returned ender clears the label, and is harmless to call twice", () => {
    const end = beginDbTransition("Switching workspace…");
    end();

    expect(dbTransitionLabel()).toBeNull();
    expect(getWriteStateSnapshot().transition).toBeNull();

    expect(() => end()).not.toThrow();
    expect(dbTransitionLabel()).toBeNull();
  });

  it("nests: an inner label takes over, and ending it restores the outer one", () => {
    const endOuter = beginDbTransition("Switching workspace…");
    expect(dbTransitionLabel()).toBe("Switching workspace…");

    const endInner = beginDbTransition("Restoring from backup…");
    expect(dbTransitionLabel()).toBe("Restoring from backup…");

    endInner();
    expect(dbTransitionLabel()).toBe("Switching workspace…");

    endOuter();
    expect(dbTransitionLabel()).toBeNull();
  });
});

describe("raw.close() / raw.open() and the implicit transition", () => {
  it("marks an implicit transition when raw.close() runs with nothing explicit in flight, and a successful raw.open() clears it", async () => {
    h = await createHarness();
    expect(dbTransitionLabel()).toBeNull();

    await raw.close();
    expect(dbTransitionLabel()).not.toBeNull();
    expect(getWriteStateSnapshot().transition).not.toBeNull();

    await raw.open(":memory:");
    expect(dbTransitionLabel()).toBeNull();
    expect(getWriteStateSnapshot().transition).toBeNull();
  });

  it("leaves an explicit transition's label alone when raw.close() runs during it", async () => {
    h = await createHarness();

    const end = beginDbTransition("Switching workspace…");
    await raw.close();

    expect(dbTransitionLabel()).toBe("Switching workspace…");

    end();
    // The close already ran with an explicit transition in flight, so ending
    // that transition does not retroactively invent an implicit one either.
    expect(dbTransitionLabel()).toBeNull();

    await raw.open(":memory:");
  });
});
