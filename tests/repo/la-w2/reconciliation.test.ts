/**
 * LA-W2 / J7 — Reports reconciliation, on one populated dataset, at the
 * repository layer against real SQLite (tests/repo/harness.ts).
 *
 * The method: build a dataset with EVERY figure known by construction (the
 * cents, the won/lost stages, the due dates, the sources), track the
 * expected numbers as plain arithmetic in this file as they are built —
 * never by copying the production SQL — and then compare the report
 * function's answer against that hand-kept figure. A mismatch is a finding,
 * per the LA-W2 packet, not something to reconcile away.
 *
 * Reference date for aging: 2026-06-15 (fixed, so the aging buckets do not
 * depend on when this suite happens to run). Everything else is created at
 * "now" and read back with a period wide enough to hold it (2000-01-01 to
 * 2100-01-01), so the deal/contact/company creation timestamps need no
 * stubbing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import * as companies from "@/db/repos/companies";
import * as deals from "@/db/repos/deals";
import * as documents from "@/db/repos/documents";
import * as payments from "@/db/repos/payments";
import * as pipelines from "@/db/repos/pipelines";
import * as stages from "@/db/repos/stages";
import * as receivables from "@/db/repos/receivables";
import { dealsSummary, peopleTotals, revenueMoney } from "@/db/repos/reports";
import { sourcePerformance } from "@/db/repos/sourceReport";
import type { Period } from "@/lib/periods";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const WIDE_PERIOD: Period = {
  id: "custom",
  label: "everything",
  from: "2000-01-01T00:00:00.000Z",
  to: "2100-01-01T00:00:00.000Z",
};

const REFERENCE_DAY = "2026-06-15";

type StageByName = Record<string, { id: string; isWon: boolean; isLost: boolean }>;

async function stagesByName(): Promise<StageByName> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  const out: StageByName = {};
  for (const s of all) out[s.name] = { id: s.id, isWon: s.isWon, isLost: s.isLost };
  return out;
}

async function sourceIdByName(name: string): Promise<string> {
  const rows = await raw.query(`SELECT id FROM sources WHERE name = ?`, [name]);
  if (rows.length === 0) throw new Error(`no seeded source named "${name}"`);
  return String(rows[0][0]);
}

/** Set an invoice's due_on directly, so aging buckets are deterministic against REFERENCE_DAY. */
async function setDueOn(documentId: string, dueOn: string): Promise<void> {
  await raw.execute(`UPDATE documents SET due_on = ? WHERE id = ?`, [dueOn, documentId]);
}

describe("LA-W2 J7: reports reconciliation on one populated dataset", () => {
  it("Revenue, Deals, People, Receivables and Leads-by-source all reconcile to hand-kept figures", async () => {
    h = await createSeededHarness();
    const byStage = await stagesByName();
    const websiteId = await sourceIdByName("Website");
    const referralId = await sourceIdByName("Referral");

    // ---- People -----------------------------------------------------------
    const companyA = await companies.create({ name: "Acme Landscaping" });
    const companyB = await companies.create({ name: "Ridgeway Farms" });
    const contactA = await contacts.create({ firstName: "Dana", lastName: "Reed", companyId: companyA.id });
    const contactB = await contacts.create({ firstName: "Priya", lastName: "Raman" });
    const contactC = await contacts.create({ firstName: "No", lastName: "Deal" }); // never gets a deal
    const EXPECTED_CONTACTS = 3;
    const EXPECTED_COMPANIES = 2;

    // ---- Deals, by source and stage, with known values ---------------------
    // Website: one open (New), one won ($200,000), one won ($50,000, gets a
    // fully-paid invoice).
    await deals.create({
      title: "Website open job",
      stageId: byStage.New.id,
      sourceId: websiteId,
      contactId: contactA.id,
      valueCents: 100_000,
    });
    const dWebsiteWonBig = await deals.create({
      title: "Website won big",
      stageId: byStage.New.id,
      sourceId: websiteId,
      companyId: companyA.id,
      valueCents: 200_000,
    });
    await deals.moveToStage(dWebsiteWonBig.id, byStage.Won.id);
    const dWebsiteWonInvoiced = await deals.create({
      title: "Website won, invoiced and paid",
      stageId: byStage.New.id,
      sourceId: websiteId,
      contactId: contactA.id,
      valueCents: 50_000,
    });
    await deals.moveToStage(dWebsiteWonInvoiced.id, byStage.Won.id);

    // Referral: one won ($150,000), one lost ($50,000).
    const dReferralWon = await deals.create({
      title: "Referral won",
      stageId: byStage.New.id,
      sourceId: referralId,
      contactId: contactB.id,
      valueCents: 150_000,
    });
    await deals.moveToStage(dReferralWon.id, byStage.Won.id);
    const dReferralLost = await deals.create({
      title: "Referral lost",
      stageId: byStage.New.id,
      sourceId: referralId,
      contactId: contactB.id,
      valueCents: 50_000,
    });
    await deals.moveToStage(dReferralLost.id, byStage.Lost.id, {
      outcomeReason: "Went with someone else",
    });

    // No source ("Unknown" bucket): one open, invoiced but not yet due.
    const dUnknownOpen = await deals.create({
      title: "No source, invoiced",
      stageId: byStage.Quoted.id,
      companyId: companyB.id,
      valueCents: 120_000,
    });

    // Another deal, invoiced and part-paid, overdue by 45 days as of the
    // reference day (bucket "31-60").
    const dOverdue45 = await deals.create({
      title: "Overdue 45 days",
      stageId: byStage.Scheduled.id,
      sourceId: websiteId,
      contactId: contactB.id,
      valueCents: 50_000,
    });

    // Another, overdue by 100 days as of the reference day (bucket "90+").
    const dOverdue100 = await deals.create({
      title: "Overdue 100 days",
      stageId: byStage.Scheduled.id,
      sourceId: referralId,
      companyId: companyB.id,
      valueCents: 200_000,
    });

    const EXPECTED_DEALS_TOTAL = 8;

    // ---- Documents: invoiced, collected, outstanding, aging ---------------
    async function invoiceFor(dealId: string, totalCents: number, dueOn?: string): Promise<documents.Document> {
      const created = await documents.create({
        kind: "invoice",
        dealId,
        prefix: "INV",
        taxRateBp: 0,
        items: [{ name: "Job", qty: 1, unitCents: totalCents, taxable: false }],
      });
      const sent = await documents.send(created.id);
      if (dueOn) await setDueOn(created.id, dueOn);
      return sent;
    }

    // dWebsiteWonInvoiced: $50,000, sent, fully paid -> Collected, not receivable.
    const invPaid = await invoiceFor(dWebsiteWonInvoiced.id, 50_000);
    await payments.recordFullPayment(invPaid.id, { method: "cash" });

    // dUnknownOpen: $120,000, sent, due in the future (current bucket), unpaid.
    const invCurrent = await invoiceFor(dUnknownOpen.id, 120_000);
    await setDueOn(invCurrent.id, "2026-07-01"); // 16 days AFTER the reference day

    // dOverdue45: $50,000, sent, part-paid $20,000 -> balance $30,000, due 45
    // days before the reference day.
    const inv45 = await invoiceFor(dOverdue45.id, 50_000);
    await setDueOn(inv45.id, "2026-05-01"); // 45 days before 2026-06-15
    await payments.create({ documentId: inv45.id, amountCents: 20_000, method: "check" });

    // dOverdue100: $200,000, sent, unpaid, due 100 days before the reference day.
    const inv100 = await invoiceFor(dOverdue100.id, 200_000);
    await setDueOn(inv100.id, "2026-03-07"); // 100 days before 2026-06-15

    // A quote must never be counted as invoiced/receivable/collected: a
    // control row that reconciliation must NOT pick up.
    const controlDeal = await deals.create({
      title: "Quote only, not invoiced",
      stageId: byStage.Quoted.id,
      sourceId: websiteId,
      contactId: contactC.id,
      valueCents: 999_999,
    });
    await documents.create({
      kind: "quote",
      dealId: controlDeal.id,
      prefix: "Q",
      taxRateBp: 0,
      items: [{ name: "Not billed", qty: 1, unitCents: 999_999, taxable: false }],
    });

    /* ------------------------------------------------------------------ *
     * Hand-kept expected figures, computed by construction, not by SQL.  *
     * ------------------------------------------------------------------ */

    // ---- Revenue: independently-tallied figures -----------------------
    const revExpectedInvoiced = 50_000 + 120_000 + 50_000 + 200_000;
    const revExpectedCollected = 50_000 + 20_000;
    const revExpectedOutstanding = 120_000 + 30_000 + 200_000;

    const revenue = await revenueMoney(WIDE_PERIOD);
    const revenueTable = {
      invoicedCents: { report: revenue.totals.invoicedCents, byHand: revExpectedInvoiced },
      collectedCents: { report: revenue.totals.collectedCents, byHand: revExpectedCollected },
      outstandingCents: { report: revenue.totals.outstandingCents, byHand: revExpectedOutstanding },
    };
    console.log("J7 Revenue reconciliation:", JSON.stringify(revenueTable, null, 2));
    expect(revenue.totals.invoicedCents).toBe(revExpectedInvoiced);
    expect(revenue.totals.collectedCents).toBe(revExpectedCollected);
    expect(revenue.totals.outstandingCents).toBe(revExpectedOutstanding);

    // An independent SQL sum (never through money.ts) for the payments side,
    // the same check J4 makes: Collected must equal the raw sum of payments.
    const rawCollected = await raw.query(
      `SELECT coalesce(sum(p.amount_cents), 0) FROM payments p
       JOIN documents d ON d.id = p.document_id
       WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'invoice'`,
    );
    expect(Number(rawCollected[0][0])).toBe(revenue.totals.collectedCents);

    // ---- Deals: independently-tallied figures --------------------------
    const dealsExpectedWonCount = 3;
    const dealsExpectedLostCount = 1;
    const dealsExpectedWonValue = 200_000 + 50_000 + 150_000;
    const dealsExpectedNewCount = EXPECTED_DEALS_TOTAL + 1; // + the control deal

    const dealsRes = await dealsSummary(WIDE_PERIOD);
    const dealsTable = {
      newCount: { report: dealsRes.newCount, byHand: dealsExpectedNewCount },
      wonCount: { report: dealsRes.wonCount, byHand: dealsExpectedWonCount },
      lostCount: { report: dealsRes.lostCount, byHand: dealsExpectedLostCount },
      wonValueCents: { report: dealsRes.wonValueCents, byHand: dealsExpectedWonValue },
    };
    console.log("J7 Deals reconciliation:", JSON.stringify(dealsTable, null, 2));
    expect(dealsRes.newCount).toBe(dealsExpectedNewCount);
    expect(dealsRes.wonCount).toBe(dealsExpectedWonCount);
    expect(dealsRes.lostCount).toBe(dealsExpectedLostCount);
    expect(dealsRes.wonValueCents).toBe(dealsExpectedWonValue);

    // ---- People: independently-tallied figures -------------------------
    const peopleRes = await peopleTotals(WIDE_PERIOD);
    const peopleTable = {
      contacts: { report: peopleRes.contacts, byHand: EXPECTED_CONTACTS },
      companies: { report: peopleRes.companies, byHand: EXPECTED_COMPANIES },
    };
    console.log("J7 People reconciliation:", JSON.stringify(peopleTable, null, 2));
    expect(peopleRes.contacts).toBe(EXPECTED_CONTACTS);
    expect(peopleRes.companies).toBe(EXPECTED_COMPANIES);

    // ---- Receivables: BALANCES, aged correctly, against REFERENCE_DAY --
    const agingRes = await receivables.aging(REFERENCE_DAY);
    const bucketByName = new Map(agingRes.rows.map((r) => [r.bucket, r]));
    const receivablesTable = {
      current: { report: bucketByName.get("current"), byHand: { count: 1, cents: 120_000 } },
      "1-30": { report: bucketByName.get("1-30"), byHand: { count: 0, cents: 0 } },
      "31-60": { report: bucketByName.get("31-60"), byHand: { count: 1, cents: 30_000 } },
      "61-90": { report: bucketByName.get("61-90"), byHand: { count: 0, cents: 0 } },
      "90+": { report: bucketByName.get("90+"), byHand: { count: 1, cents: 200_000 } },
      totalCents: { report: agingRes.totalCents, byHand: 120_000 + 30_000 + 200_000 },
    };
    console.log("J7 Receivables reconciliation:", JSON.stringify(receivablesTable, null, 2));
    expect(bucketByName.get("current")).toEqual({ bucket: "current", count: 1, cents: 120_000 });
    expect(bucketByName.get("31-60")).toEqual({ bucket: "31-60", count: 1, cents: 30_000 });
    expect(bucketByName.get("90+")).toEqual({ bucket: "90+", count: 1, cents: 200_000 });
    expect(agingRes.totalCents).toBe(120_000 + 30_000 + 200_000);
    // The point of PX-5: this is the BALANCE (30,000), never the total (50,000).
    const outstandingRows = await receivables.outstanding(REFERENCE_DAY);
    const row45 = outstandingRows.find((r) => r.id === inv45.id)!;
    expect(row45.totalCents).toBe(50_000);
    expect(row45.paidCents).toBe(20_000);
    expect(row45.balanceCents).toBe(30_000);
    expect(row45.status).toBe("partial");

    // ---- Leads by source: independently-tallied figures -----------------
    const websiteExpected = {
      // dWebsiteOpen, dWebsiteWonBig, dWebsiteWonInvoiced, dOverdue45, controlDeal
      leads: 5,
      won: 2, // dWebsiteWonBig, dWebsiteWonInvoiced
      wonValueCents: 200_000 + 50_000,
    };
    const referralExpected = {
      // dReferralWon, dReferralLost, dOverdue100
      leads: 3,
      won: 1,
      wonValueCents: 150_000,
    };
    const unknownExpected = {
      // dUnknownOpen only
      leads: 1,
      won: 0,
      wonValueCents: 0,
    };

    const perf = await sourcePerformance(WIDE_PERIOD);
    const byId = new Map(perf.map((r) => [r.sourceId, r]));
    const sourcesTable = {
      website: { report: byId.get(websiteId), byHand: websiteExpected },
      referral: { report: byId.get(referralId), byHand: referralExpected },
      unknown: { report: byId.get(""), byHand: unknownExpected },
    };
    console.log("J7 Leads-by-source reconciliation:", JSON.stringify(sourcesTable, null, 2));
    expect(byId.get(websiteId)?.leads).toBe(websiteExpected.leads);
    expect(byId.get(websiteId)?.won).toBe(websiteExpected.won);
    expect(byId.get(websiteId)?.wonValueCents).toBe(websiteExpected.wonValueCents);
    expect(byId.get(referralId)?.leads).toBe(referralExpected.leads);
    expect(byId.get(referralId)?.won).toBe(referralExpected.won);
    expect(byId.get(referralId)?.wonValueCents).toBe(referralExpected.wonValueCents);
    expect(byId.get("")?.leads).toBe(unknownExpected.leads);
  });
});
