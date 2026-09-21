/**
 * Install day must not hand the owner a to-do list he did not write.
 *
 * Automations (LR-PX-C) ship with two rules ON: an hour after a website lead
 * arrives, put a call on the list; three days after a quote goes out, remind
 * me to chase it. Both are right for work that is genuinely new. Neither is
 * right for an import, which is the first thing that happens on install day
 * and is the owner's *existing* customers, most of them years old.
 *
 * If a 3,000-row import fired the lead rule, the owner's first Today would be
 * three thousand overdue calls, and the product would have made itself
 * useless in the first ten minutes of owning it. That is the failure this
 * file exists to prevent, and it is the reason it asserts the absence of rows
 * rather than the presence of them.
 *
 * The protection today is structural rather than conditional: the importers
 * write through `insertStatement` into a batch, and the two firing sites are
 * `applyLeadPage` (a page of leads off the website) and `deals.moveToStage`
 * (a real stage change). An import passes through neither. That is exactly
 * the kind of guarantee that holds until somebody refactors an importer to go
 * "properly" through the repository - so it is pinned here, at the level the
 * owner would feel it, not at the level the code happens to be arranged in
 * today.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as tasks from "../../../src/db/repos/tasks";
import * as stagesRepo from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as dealsRepo from "../../../src/db/repos/deals";
import * as automations from "../../../src/db/repos/automations";
import { readHeaders, sniffCsv } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import { runImport } from "../../../src/features/data/lib/importRun";
import { guessMappingFor } from "../../../src/features/data/lib/typedMapping";
import { runTypedImport } from "../../../src/features/data/lib/typedImportRun";
import { DEALS_IMPORT } from "../../../src/features/data/import/fields/deals";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "..", "..", "fixtures", name);

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/** Every task an automation created, whatever rule made it. */
async function automationTasks(): Promise<number> {
  const page = await tasks.list({ source: "automation" }, { limit: 500 });
  return page.total;
}

describe("an import creates no automated follow-ups", () => {
  it("leaves the two default-on rules exactly as they are: on, and not fired", async () => {
    h = await createSeededHarness();

    // The premise. If either of these ever ships off, this file is asserting
    // nothing and should be read again rather than trusted.
    const lead = await automations.get("lead_arrived");
    const quote = await automations.get("quote_sent");
    expect(lead?.enabled, "lead_arrived ships on").toBe(true);
    expect(quote?.enabled, "quote_sent ships on").toBe(true);

    expect(await automationTasks()).toBe(0);
  });

  it("a contacts import of 52 people creates no tasks at all", async () => {
    h = await createSeededHarness();

    const bytes = new Uint8Array(readFileSync(fixture("hubspot-contacts.csv")));
    const sniff = sniffCsv(bytes);
    const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
    const result = await runImport({
      text: sniff.text,
      mapping: guessMapping(headers),
      delimiter,
      policy: "skip",
    });

    expect(result.created).toBe(52);
    expect(await automationTasks(), "no automation fired on a contacts import").toBe(0);
    // Not "no automation tasks" but "no tasks": an import of a customer list
    // is not a promise to do anything, and Today is built out of promises.
    const all = await tasks.list({}, { limit: 500 });
    expect(all.total, "an imported customer list is not a to-do list").toBe(0);
  });

  it("a deals import creates the jobs and none of their follow-ups", async () => {
    h = await createSeededHarness();

    const bytes = new Uint8Array(readFileSync(fixture("hubspot-deals.csv")));
    const sniff = sniffCsv(bytes);
    const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
    const pipeline = await pipelines.getDefault();
    const stages = pipeline ? await stagesRepo.list(pipeline.id) : [];

    // The worst case for this rule: a stage that DOES carry a follow-up. A
    // deals import lands rows straight into stages, so if it went through the
    // move path every imported job would arrive with a reminder attached.
    const target = stages[0];
    expect(target, "the seed gives the default pipeline its stages").toBeTruthy();
    await stagesRepo.update(target.id, {
      followUpDays: 2,
      followUpTitle: "Ring {name} about {job}",
    });

    const result = await runTypedImport({
      typeId: "deals",
      text: sniff.text,
      mapping: guessMappingFor(DEALS_IMPORT, headers),
      delimiter,
      policy: "skip",
    });

    expect(result.created).toBeGreaterThan(0);
    expect(
      await automationTasks(),
      "an imported job is history, not a job that just moved",
    ).toBe(0);
  });

  it("but a real stage move into that same stage does fire it, once", async () => {
    h = await createSeededHarness();

    const pipeline = await pipelines.getDefault();
    const stages = pipeline ? await stagesRepo.list(pipeline.id) : [];
    const [first, second] = stages;
    await stagesRepo.update(second.id, {
      followUpDays: 2,
      followUpTitle: "Ring {name} about {job}",
    });

    const deal = await dealsRepo.create({
      title: "Spring cleanup",
      stageId: first.id,
    });
    expect(await automationTasks()).toBe(0);

    await dealsRepo.moveToStage(deal.id, second.id);
    expect(await automationTasks(), "a real move is what the rule is for").toBe(1);

    // Re-picking the stage it already sits in is not an entry.
    await dealsRepo.moveToStage(deal.id, second.id);
    expect(await automationTasks(), "and it fires once, not on every save").toBe(1);
  });
});
