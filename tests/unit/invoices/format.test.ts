/**
 * LR-PX-A / W2: the pure helpers behind the payments feature - the status
 * pill's new "Partially paid" word, the overdue test that now covers it, the
 * "N unpaid, $X outstanding" sentence's new part-paid clause, and the two
 * money-fraction helpers ("$X of $Y", "$Z still owed") that back both the
 * Payments card's header line and the deal money strip.
 */
import { describe, expect, it } from "vitest";
import {
  balanceLabel,
  hasBalance,
  isOverdue,
  paidOfLabel,
  paymentsBlockedReason,
  paymentsRunningBalance,
  statusLabel,
  statusTone,
  summarySentence,
  type OutstandingSummary,
} from "../../../src/features/invoices/lib/format";

describe("statusLabel", () => {
  it("reads a partially paid invoice as a sentence-case word, not the raw status", () => {
    expect(statusLabel("partial")).toBe("Partially paid");
  });
});

describe("statusTone", () => {
  it("does not colour a partly paid invoice - it is still owed, not an outcome", () => {
    expect(statusTone("partial")).toBe("neutral");
  });
});

describe("isOverdue", () => {
  const dueOn = "2026-01-01";
  const reference = "2026-02-01";

  it("treats a partial invoice exactly like a sent one", () => {
    expect(isOverdue({ status: "partial", kind: "invoice", dueOn }, reference)).toBe(true);
    expect(isOverdue({ status: "sent", kind: "invoice", dueOn }, reference)).toBe(true);
  });

  it("a partial invoice not past its due date is not overdue", () => {
    expect(isOverdue({ status: "partial", kind: "invoice", dueOn: "2026-03-01" }, reference)).toBe(
      false,
    );
  });

  it("still ignores paid, void and draft invoices, and every quote", () => {
    expect(isOverdue({ status: "paid", kind: "invoice", dueOn }, reference)).toBe(false);
    expect(isOverdue({ status: "void", kind: "invoice", dueOn }, reference)).toBe(false);
    expect(isOverdue({ status: "draft", kind: "invoice", dueOn }, reference)).toBe(false);
    expect(isOverdue({ status: "partial", kind: "quote", dueOn }, reference)).toBe(false);
  });
});

describe("paidOfLabel", () => {
  it('reads "$X of $Y" with no verb of its own', () => {
    expect(paidOfLabel(50000, 120000)).toBe("$500.00 of $1,200.00");
  });
});

describe("balanceLabel", () => {
  it("names what is left", () => {
    expect(balanceLabel(70000)).toBe("$700.00 still owed");
  });

  it("reads settled once nothing is left, including an overpayment", () => {
    expect(balanceLabel(0)).toBe("Paid in full");
    expect(balanceLabel(-500)).toBe("Paid in full");
  });
});

describe("paymentsBlockedReason", () => {
  it("names the two documents.assertTakesPayments refuses", () => {
    expect(paymentsBlockedReason({ kind: "invoice", status: "draft", number: "INV-1" })).toBe(
      "INV-1 is still a draft. Send it before recording a payment.",
    );
    expect(paymentsBlockedReason({ kind: "invoice", status: "void", number: "INV-1" })).toBe(
      "INV-1 is void, so there is nothing to pay.",
    );
  });

  it("is null wherever a payment is actually possible", () => {
    for (const status of ["sent", "partial", "paid"]) {
      expect(paymentsBlockedReason({ kind: "invoice", status, number: "INV-1" })).toBeNull();
    }
  });

  it("names a quote too, even though the Payments card never mounts on one", () => {
    expect(paymentsBlockedReason({ kind: "quote", status: "sent", number: "Q-1" })).toBe(
      "Q-1 is a quote, not an invoice.",
    );
  });
});

describe("paymentsRunningBalance", () => {
  it("walks the balance down oldest first", () => {
    expect(paymentsRunningBalance(120000, [50000, 70000])).toEqual([70000, 0]);
  });

  it("is the invoice's own total with no payments yet", () => {
    expect(paymentsRunningBalance(120000, [])).toEqual([]);
  });

  it("goes negative on an overpayment rather than clamping - the table shows what actually happened", () => {
    expect(paymentsRunningBalance(100000, [120000])).toEqual([-20000]);
  });
});

describe("hasBalance", () => {
  it("is true for an invoice with something owed", () => {
    expect(hasBalance("invoice", 100)).toBe(true);
  });

  it("is false for a quote, whatever balance figure it is handed", () => {
    expect(hasBalance("quote", 100)).toBe(false);
  });

  it("is false at zero, negative, or missing", () => {
    expect(hasBalance("invoice", 0)).toBe(false);
    expect(hasBalance("invoice", -50)).toBe(false);
    expect(hasBalance("invoice", undefined)).toBe(false);
    expect(hasBalance("invoice", null)).toBe(false);
  });
});

describe("summarySentence: the part-paid clause (LR-PX-A addition 9)", () => {
  const base: OutstandingSummary = {
    sentCount: 0,
    outstandingCents: 0,
    overdueCount: 0,
    worstOverdueDays: 0,
    draftCount: 0,
    partialCount: 0,
  };

  it("names one part-paid invoice", () => {
    const summary: OutstandingSummary = {
      ...base,
      sentCount: 3,
      outstandingCents: 215000,
      partialCount: 1,
      overdueCount: 1,
      worstOverdueDays: 12,
    };
    expect(summarySentence(summary)).toBe(
      "3 unpaid, $2,150.00 outstanding, 1 part paid, 1 overdue by 12 days.",
    );
  });

  it("names several", () => {
    const summary: OutstandingSummary = {
      ...base,
      sentCount: 5,
      outstandingCents: 300000,
      partialCount: 2,
    };
    expect(summarySentence(summary)).toBe("5 unpaid, $3,000.00 outstanding, 2 part paid.");
  });

  it("says nothing about part payment when there is none", () => {
    const summary: OutstandingSummary = { ...base, sentCount: 2, outstandingCents: 40000 };
    expect(summarySentence(summary)).toBe("2 unpaid, $400.00 outstanding.");
  });
});
