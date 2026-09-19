import { describe, expect, it } from "vitest";
import { isId, newBatchId, newId } from "@/lib/ids";

describe("ids", () => {
  it("makes UUID v7 strings", () => {
    const id = newId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
  });

  it("sorts in creation order, which is the point of v7", () => {
    const first = newId();
    const later = Array.from({ length: 50 }, () => newId());
    const sorted = [first, ...later].slice().sort();
    expect(sorted[0]).toBe(first);
  });

  it("batch ids are ids too", () => {
    expect(isId(newBatchId())).toBe(true);
  });

  it("recognises its own ids and rejects anything else", () => {
    expect(isId(newId())).toBe(true);
    expect(isId("not-an-id")).toBe(false);
    expect(isId("")).toBe(false);
    expect(isId(null)).toBe(false);
    expect(isId(42)).toBe(false);
  });
});
