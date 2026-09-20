/**
 * CPO-LA-3 (a): a record in the Trash because it LOST a merge is a different
 * thing from one the owner deleted, and the Trash has to be able to tell them
 * apart.
 *
 * Restoring a merge loser would rebuild an empty duplicate of a record that
 * already exists — the merge moved every phone, email, task, deal and activity
 * to the survivor — so the pages hide Restore and say who it was folded into
 * instead (CPO audit, scenario 7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import * as trash from "../../src/db/repos/trash";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as merge from "../../src/db/repos/merge";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("trash.mergedInto", () => {
  it("names the survivor a merged-away contact was folded into", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Marla", lastName: "Quintero" });
    const loser = await contacts.create({ firstName: "Marla", lastName: "Q" });

    await merge.merge("contact", survivor.id, loser.id);

    const found = await trash.mergedInto("contact", loser.id);
    expect(found).not.toBeNull();
    expect(found?.survivorId).toBe(survivor.id);
    expect(found?.survivorName).toBe("Marla Quintero");
  });

  it("says nothing about a contact the owner simply deleted", async () => {
    h = await createSeededHarness();
    const deleted = await contacts.create({ firstName: "Hollis", lastName: "Fenwick" });
    await contacts.softDelete(deleted.id);

    expect(await trash.mergedInto("contact", deleted.id)).toBeNull();
  });

  it("stops naming a survivor once the merge has been reversed", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Elias", lastName: "Thorvald" });
    const loser = await contacts.create({ firstName: "Elias", lastName: "T" });
    const result = await merge.merge("contact", survivor.id, loser.id);

    expect(await trash.mergedInto("contact", loser.id)).not.toBeNull();
    await merge.reverse(result.mergeId);
    // The reversal already put the loser back; it is not a merge casualty any
    // more, and if it is ever deleted again that is an ordinary deletion.
    expect(await trash.mergedInto("contact", loser.id)).toBeNull();
  });

  it("does the same for companies, by name", async () => {
    h = await createSeededHarness();
    const survivor = await companies.create({ name: "Stonebridge Meadows HOA" });
    const loser = await companies.create({ name: "Stonebridge Meadows H.O.A." });

    await merge.merge("company", survivor.id, loser.id);

    const found = await trash.mergedInto("company", loser.id);
    expect(found?.survivorId).toBe(survivor.id);
    expect(found?.survivorName).toBe("Stonebridge Meadows HOA");
  });

  it("carries the survivor onto the Trash row, and leaves an ordinary deletion alone", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Royce", lastName: "Balthazar" });
    const loser = await contacts.create({ firstName: "Royce", lastName: "B" });
    const plain = await contacts.create({ firstName: "Jasper", lastName: "Mbeki" });
    await merge.merge("contact", survivor.id, loser.id);
    await contacts.softDelete(plain.id);

    const rows = await trash.list("contact");
    const mergedRow = rows.find((row) => row.entityId === loser.id);
    const plainRow = rows.find((row) => row.entityId === plain.id);

    expect(mergedRow?.mergedInto?.survivorName).toBe("Royce Balthazar");
    expect(plainRow?.mergedInto ?? null).toBeNull();
  });
});
