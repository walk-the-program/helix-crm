import { describe, it, expect } from "vitest";
import { dealCustomer } from "@/features/records/components/DealCard";
import type { Deal } from "@/db/repos/deals";

/**
 * F-LA-12 (the board card names the customer, not a thing the deal does not
 * have) and F-LA-9 (a trashed contact or company still names itself, marked).
 */
function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    title: "Full front yard redesign, Aspen Hollow",
    valueCents: 1480000,
    currency: "USD",
    stageId: "estimate",
    stageName: "Estimate sent",
    stageIsWon: false,
    stageIsLost: false,
    stageEnteredAt: "2026-06-01T00:00:00.000Z",
    position: 0,
    contactId: null,
    contactFirstName: null,
    contactLastName: null,
    contactDeletedAt: null,
    companyId: null,
    companyName: null,
    companyDeletedAt: null,
    sourceId: null,
    externalId: null,
    expectedOn: null,
    closedAt: null,
    outcomeReason: null,
    oneTimeCents: 1480000,
    recurringMonthlyCents: 0,
    recurringStartedOn: null,
    recurringEndedOn: null,
    suggestedTotalCents: 1480000,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("dealCustomer", () => {
  it("contact only: the person's name, no tooltip mark", () => {
    const result = dealCustomer(
      deal({ contactId: "c1", contactFirstName: "Priya", contactLastName: "Raghunathan" }),
    );
    expect(result.name).toBe("Priya Raghunathan");
    expect(result.deletedAt).toBeNull();
    expect(result.tooltip).toBe("Priya Raghunathan");
  });

  it("company only: the company's name", () => {
    const result = dealCustomer(deal({ companyId: "co1", companyName: "Sorensen Landscaping" }));
    expect(result.name).toBe("Sorensen Landscaping");
    expect(result.deletedAt).toBeNull();
  });

  it("both: the person is the label, the company is the tooltip", () => {
    const result = dealCustomer(
      deal({
        contactId: "c1",
        contactFirstName: "Priya",
        contactLastName: "Raghunathan",
        companyId: "co1",
        companyName: "Aspen Hollow HOA",
      }),
    );
    expect(result.name).toBe("Priya Raghunathan");
    expect(result.tooltip).toBe("Aspen Hollow HOA");
  });

  it("neither: No customer", () => {
    const result = dealCustomer(deal());
    expect(result.name).toBe("No customer");
    expect(result.deletedAt).toBeNull();
  });

  it("a trashed company (no contact) carries its deletedAt for the mark", () => {
    const result = dealCustomer(
      deal({
        companyId: "co1",
        companyName: "Stonebridge Meadows HOA",
        companyDeletedAt: "2026-06-10T00:00:00.000Z",
      }),
    );
    expect(result.name).toBe("Stonebridge Meadows HOA");
    expect(result.deletedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(result.tooltip).toBe("Stonebridge Meadows HOA (in Trash)");
  });

  it("a trashed contact carries its own deletedAt even when the company is live", () => {
    const result = dealCustomer(
      deal({
        contactId: "c1",
        contactFirstName: "Marla",
        contactLastName: "Quintero",
        contactDeletedAt: "2026-06-11T00:00:00.000Z",
        companyId: "co1",
        companyName: "Stonebridge Meadows HOA",
      }),
    );
    expect(result.name).toBe("Marla Quintero");
    expect(result.deletedAt).toBe("2026-06-11T00:00:00.000Z");
    // The company, not the contact, is what the tooltip names here.
    expect(result.tooltip).toBe("Stonebridge Meadows HOA");
  });
});
