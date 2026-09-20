/**
 * Pure unit tests for the two rules the payments model stands on
 * (`documents.deriveInvoiceStatus`, `payments.paymentActivityBody`) plus
 * `payments.normalizeMethod`. None of these touch a database - that is the
 * whole point of writing them as pure functions in the first place.
 */
import { describe, expect, it } from "vitest";
import { deriveInvoiceStatus } from "@/db/repos/documents";
import { normalizeMethod, paymentActivityBody } from "@/db/repos/payments";

describe("documents.deriveInvoiceStatus", () => {
  it("is sent when nothing has been paid", () => {
    expect(deriveInvoiceStatus(10_000, 0)).toBe("sent");
  });

  it("is partial when some but not all has been paid", () => {
    expect(deriveInvoiceStatus(10_000, 1)).toBe("partial");
    expect(deriveInvoiceStatus(10_000, 9_999)).toBe("partial");
  });

  it("is paid when payments exactly cover the total", () => {
    expect(deriveInvoiceStatus(10_000, 10_000)).toBe("paid");
  });

  it("is paid on an overpayment, not partial and not an error", () => {
    expect(deriveInvoiceStatus(10_000, 10_001)).toBe("paid");
  });

  it("a zero-total invoice with no payments reads paid, not sent", () => {
    // 0 >= 0 is true, so an invoice worth nothing is never "owed" - which is
    // also why the 0006 backfill skips zero-total invoices outright: they
    // would read paid either way, so there is nothing for a payment to prove.
    expect(deriveInvoiceStatus(0, 0)).toBe("paid");
  });

  it("a zero-total invoice cannot be partial: any payment on it is already an overpayment", () => {
    expect(deriveInvoiceStatus(0, 1)).toBe("paid");
  });

  it("a negative total (a fully-credited invoice) still reads paid at zero payments", () => {
    expect(deriveInvoiceStatus(-500, 0)).toBe("paid");
  });
});

describe("payments.normalizeMethod", () => {
  it("passes the five known methods through unchanged", () => {
    expect(normalizeMethod("cash")).toBe("cash");
    expect(normalizeMethod("check")).toBe("check");
    expect(normalizeMethod("card")).toBe("card");
    expect(normalizeMethod("transfer")).toBe("transfer");
    expect(normalizeMethod("other")).toBe("other");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeMethod("  CASH  ")).toBe("cash");
    expect(normalizeMethod("Check")).toBe("check");
  });

  it("recognizes 'cheque' as a check", () => {
    expect(normalizeMethod("cheque")).toBe("check");
  });

  it("recognizes card brand names as a card", () => {
    expect(normalizeMethod("Visa ending 4242")).toBe("card");
    expect(normalizeMethod("Amex")).toBe("card");
  });

  it("recognizes bank words as a transfer", () => {
    expect(normalizeMethod("bank transfer")).toBe("transfer");
    expect(normalizeMethod("ACH")).toBe("transfer");
    expect(normalizeMethod("wire")).toBe("transfer");
    expect(normalizeMethod("Zelle")).toBe("transfer");
    expect(normalizeMethod("Venmo")).toBe("transfer");
  });

  it("falls back to other for anything unrecognised, empty, null or undefined", () => {
    expect(normalizeMethod("Bitcoin")).toBe("other");
    expect(normalizeMethod("")).toBe("other");
    expect(normalizeMethod("   ")).toBe("other");
    expect(normalizeMethod(null)).toBe("other");
    expect(normalizeMethod(undefined)).toBe("other");
  });
});

describe("payments.paymentActivityBody", () => {
  // Locale pinned to "en-US" the same way tests/unit/money.test.ts pins it:
  // `Intl.NumberFormat(undefined, ...)` would otherwise format against
  // whatever locale the machine running the suite happens to default to.
  const base = {
    amountCents: 50_000,
    balanceCents: 20_000,
    number: "INV-2026-0004",
    currency: "USD",
    locale: "en-US",
  };

  it("recorded, not settled: names the amount and what is still owed", () => {
    const body = paymentActivityBody("recorded", base);
    expect(body).toBe("Paid $500.00 · $200.00 still owed on INV-2026-0004");
  });

  it("recorded with a method: names how it came in", () => {
    const body = paymentActivityBody("recorded", { ...base, method: "check" });
    expect(body).toBe("Paid $500.00 by check · $200.00 still owed on INV-2026-0004");
  });

  it("recorded, settled: says the invoice is settled rather than printing $0.00 owed", () => {
    const body = paymentActivityBody("recorded", { ...base, balanceCents: 0 });
    expect(body).toBe("Paid $500.00 · INV-2026-0004 is settled");
  });

  it("recorded, settled by overpayment: a negative balance still reads settled", () => {
    const body = paymentActivityBody("recorded", { ...base, balanceCents: -100 });
    expect(body).toBe("Paid $500.00 · INV-2026-0004 is settled");
  });

  it("changed, not settled", () => {
    const body = paymentActivityBody("changed", base);
    expect(body).toBe("Payment changed to $500.00 · $200.00 still owed on INV-2026-0004");
  });

  it("changed, settled", () => {
    const body = paymentActivityBody("changed", { ...base, balanceCents: 0 });
    expect(body).toBe("Payment changed to $500.00 · INV-2026-0004 is settled");
  });

  it("removed, not settled", () => {
    const body = paymentActivityBody("removed", base);
    expect(body).toBe("Payment of $500.00 removed · $200.00 still owed on INV-2026-0004");
  });

  it("removed, settled (removing a payment that still leaves it fully covered by others)", () => {
    const body = paymentActivityBody("removed", { ...base, balanceCents: 0 });
    expect(body).toBe("Payment of $500.00 removed · INV-2026-0004 is settled");
  });
});
