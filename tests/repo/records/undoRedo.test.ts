/**
 * Undo and redo as a round trip.
 *
 * `tests/repo/records/undoFlow.test.ts` already proves that `undoBatch`
 * reverses what the records screens do. This file proves the other direction:
 * that `redoBatch` puts the change back, so Cmd+Z / Shift+Cmd+Z is a walk along
 * one history rather than a one-way door (design/apple-hig-review.md,
 * finding 3).
 *
 * The five shapes the change log can hold are each covered once: create,
 * update, soft delete, a stage move (an update that also writes a
 * deal_stage_event), and a merge — which is the one case neither direction
 * replays, because only `merge.reverse` knows how to re-point rows across
 * tables.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { redoBatch, undoBatch } from "@/db/changeLog";
import { newId } from "@/lib/ids";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import * as dealsRepo from "@/db/repos/deals";
import * as stagesRepo from "@/db/repos/stages";
import * as pipelines from "@/db/repos/pipelines";
import * as mergeRepo from "@/db/repos/merge";
import * as trash from "@/db/repos/trash";

let harness: Harness;

beforeEach(async () => {
  harness = await createSeededHarness();
});

afterEach(() => {
  harness.dispose();
});

async function firstStages(): Promise<{ from: string; to: string }> {
  const pipeline = await pipelines.getDefault();
  if (!pipeline) throw new Error("The seeded workspace has no default pipeline.");
  const stages = await stagesRepo.list(pipeline.id);
  return { from: stages[0].id, to: stages[1].id };
}

describe("create", () => {
  it("redo puts back the contact undo removed", async () => {
    const batchId = newId();
    const contact = await contactsRepo.create(
      { firstName: "Marisol", lastName: "Aguirre" },
      { batchId },
    );

    await undoBatch(batchId);
    expect(await contactsRepo.get(contact.id)).toBeNull();

    await redoBatch(batchId);
    const back = await contactsRepo.get(contact.id);
    expect(back).not.toBeNull();
    expect(back?.firstName).toBe("Marisol");
    expect(back?.lastName).toBe("Aguirre");
  });
});

describe("update", () => {
  it("undo restores the old value and redo re-applies the new one", async () => {
    const contact = await contactsRepo.create({
      firstName: "Dwayne",
      lastName: "Okafor",
    });

    const batchId = newId();
    await contactsRepo.update(contact.id, { firstName: "Duane" }, { batchId });
    expect((await contactsRepo.get(contact.id))?.firstName).toBe("Duane");

    await undoBatch(batchId);
    expect((await contactsRepo.get(contact.id))?.firstName).toBe("Dwayne");

    await redoBatch(batchId);
    expect((await contactsRepo.get(contact.id))?.firstName).toBe("Duane");
  });

  it("survives a second round trip, so Cmd+Z and Shift+Cmd+Z can be held down", async () => {
    const company = await companiesRepo.create({ name: "Halvorsen Roofing" });
    const batchId = newId();
    await companiesRepo.update(company.id, { name: "Halvorsen Roofing Co." }, { batchId });

    await undoBatch(batchId);
    await redoBatch(batchId);
    await undoBatch(batchId);
    expect((await companiesRepo.get(company.id))?.name).toBe("Halvorsen Roofing");

    await redoBatch(batchId);
    expect((await companiesRepo.get(company.id))?.name).toBe("Halvorsen Roofing Co.");
  });
});

describe("soft delete", () => {
  it("redo puts the row back in the trash undo pulled it out of", async () => {
    const contact = await contactsRepo.create({ firstName: "Pearl", lastName: "Nakamura" });

    const batchId = newId();
    await contactsRepo.softDelete(contact.id, { batchId });
    expect((await contactsRepo.get(contact.id))?.deletedAt).not.toBeNull();
    expect(await trash.list("contact")).toHaveLength(1);

    await undoBatch(batchId);
    expect((await contactsRepo.get(contact.id))?.deletedAt).toBeNull();
    expect(await trash.list("contact")).toHaveLength(0);

    await redoBatch(batchId);
    expect((await contactsRepo.get(contact.id))?.deletedAt).not.toBeNull();
    expect(await trash.list("contact")).toHaveLength(1);
  });
});

describe("a stage move", () => {
  it("goes back to the stage it came from and forward again", async () => {
    const { from, to } = await firstStages();
    const deal = await dealsRepo.create({ title: "Retaining wall", stageId: from });

    const batchId = newId();
    await dealsRepo.moveTo(deal.id, to, 0, { batchId });
    expect((await dealsRepo.get(deal.id))?.stageId).toBe(to);

    await undoBatch(batchId);
    expect((await dealsRepo.get(deal.id))?.stageId).toBe(from);

    await redoBatch(batchId);
    expect((await dealsRepo.get(deal.id))?.stageId).toBe(to);
  });
});

describe("a merge", () => {
  /**
   * Not a gap: a merge re-points rows across several tables and marks a row in
   * `merges`, and replaying the change log would put half of that back. Both
   * directions skip it on purpose, and `merge.reverse(mergeId)` is the path —
   * which is why the application undo stack never carries a merge batch.
   */
  it("is left alone by both directions, and reverse is what undoes it", async () => {
    const survivor = await contactsRepo.create({ firstName: "Ana", lastName: "Ferreira" });
    const loser = await contactsRepo.create({ firstName: "Anna", lastName: "Ferreira" });

    const { mergeId, batchId } = await mergeRepo.merge("contact", survivor.id, loser.id);
    expect((await contactsRepo.get(loser.id))?.deletedAt).not.toBeNull();

    await undoBatch(batchId);
    expect((await contactsRepo.get(loser.id))?.deletedAt).not.toBeNull();

    await redoBatch(batchId);
    expect((await contactsRepo.get(loser.id))?.deletedAt).not.toBeNull();

    await mergeRepo.reverse(mergeId);
    expect((await contactsRepo.get(loser.id))?.deletedAt).toBeNull();
  });
});
