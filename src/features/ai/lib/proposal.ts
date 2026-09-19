/**
 * Turning a confirmed proposal into rows.
 *
 * The owner has read the form and pressed Confirm, so this is an ordinary
 * create - the model's output has already been through human eyes and is
 * treated as nothing more than a prefilled form.
 *
 * One transaction, because a contact without its job is worse than neither.
 * That is the reason for the shape below: the repositories' write functions all
 * take the write lock, and the lock is not reentrant (docs/STATUS.md,
 * foundations), so calling `contacts.create()` inside `withTransaction` would
 * deadlock. Instead this builds the statements with the repository's own
 * builders - `contacts.createStatements` already exists for the CSV import -
 * and sends them in one batch inside one transaction, logging both changes
 * under one batch id so a single Undo covers the pair.
 *
 * `deals.createStatements` does not exist yet; it is written here and listed in
 * docs/STATUS.md under "Contract changes needed" for promotion into
 * src/db/repos/deals.ts, after which the local copy goes away.
 */
import { withTransaction } from "@/db/writeLock";
import { raw } from "@/db/client";
import { insertStatement, logWrite, stampNew, trimmed } from "@/db/repos/_base";
import { newBatchId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import * as contacts from "@/db/repos/contacts";
import * as deals from "@/db/repos/deals";
import * as stages from "@/db/repos/stages";
import * as pipelines from "@/db/repos/pipelines";
import * as settingsRepo from "@/db/repos/settings";

export type ConfirmedProposal = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  dealTitle: string;
  dealValueCents: number;
  dealExpectedOn: string | null;
};

export type ProposalResult = {
  contactId: string;
  dealId: string;
  batchId: string;
};

/** Same rule the lead poller uses: email first, then phone. */
export async function findDuplicateContact(
  email: string | null,
  phone: string | null,
): Promise<{ id: string; name: string } | null> {
  const id = await contacts.findByEmailOrPhone(email, phone);
  if (!id) return null;
  const existing = await contacts.get(id);
  if (!existing) return null;
  return { id, name: contacts.contactName(existing) || "this contact" };
}

/**
 * Statements for one deal in its stage, mirroring `deals.create` exactly: the
 * row, plus the first `deal_stage_events` entry the reports are built on.
 */
function dealCreateStatements(input: {
  title: string;
  stageId: string;
  valueCents: number;
  currency: string;
  contactId: string | null;
  expectedOn: string | null;
  position: number;
}): { id: string; statements: { sql: string; params: unknown[] }[] } {
  const stamps = stampNew();
  const at = stamps.createdAt;
  const row = {
    ...stamps,
    title: trimmed(input.title),
    valueCents: input.valueCents,
    currency: input.currency,
    stageId: input.stageId,
    stageEnteredAt: at,
    position: input.position,
    contactId: input.contactId,
    companyId: null,
    sourceId: null,
    externalId: null,
    expectedOn: input.expectedOn,
    closedAt: null,
    outcomeReason: null,
    deletedAt: null,
  };
  return {
    id: stamps.id,
    statements: [
      insertStatement("deals", row),
      insertStatement("deal_stage_events", {
        id: stampNew().id,
        createdAt: at,
        updatedAt: at,
        dealId: stamps.id,
        fromStageId: null,
        toStageId: input.stageId,
        at,
      }),
    ],
  };
}

export async function createFromProposal(
  proposal: ConfirmedProposal,
): Promise<ProposalResult> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const stage = await stages.firstStage(pipeline.id);
  if (!stage) {
    throw new Error("This workspace has no pipeline stages yet.");
  }
  const [currency, region, existingInStage] = await Promise.all([
    settingsRepo.get("currency"),
    settingsRepo.get("defaultRegion"),
    deals.list({ stageId: stage.id }),
  ]);

  const batchId = newBatchId();

  return withTransaction(async () => {
    const contact = contacts.createStatements(
      {
        firstName: proposal.firstName,
        lastName: proposal.lastName,
        notes: proposal.notes,
        phones: proposal.phone
          ? [{ raw: proposal.phone, label: "mobile", isPrimary: true }]
          : [],
        emails: proposal.email
          ? [{ email: proposal.email, label: "work", isPrimary: true }]
          : [],
      },
      region,
    );

    const deal = dealCreateStatements({
      title: proposal.dealTitle,
      stageId: stage.id,
      valueCents: proposal.dealValueCents,
      currency,
      contactId: contact.id,
      expectedOn: proposal.dealExpectedOn,
      position: existingInStage.total,
    });

    await raw.batch([...contact.statements, ...deal.statements]);

    const at = nowIso();
    await logWrite(
      "contact",
      contact.id,
      "create",
      null,
      { firstName: proposal.firstName, lastName: proposal.lastName, at },
      batchId,
    );
    await logWrite(
      "deal",
      deal.id,
      "create",
      null,
      { title: proposal.dealTitle, stageId: stage.id, at },
      batchId,
    );

    return { contactId: contact.id, dealId: deal.id, batchId };
  }, "Saving the pasted record");
}
