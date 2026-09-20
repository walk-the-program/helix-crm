/**
 * The two rules the document page's header depends on: one busy state per
 * action, and a status list that never offers a move the repository refuses.
 *
 * Both are pure functions on purpose. The project has no jsdom and no React
 * Testing Library (vitest runs in the `node` environment, see vitest.config.ts),
 * so the way to prove "Download PDF does not put a spinner on Send" without a
 * browser is to prove it about the state those two buttons read.
 */
import { describe, expect, it } from "vitest";
import {
  anyBusy,
  fieldIssue,
  isBusy,
  statusChoices,
  statusIsFixed,
  type BusyState,
} from "../../../src/features/invoices/lib/documentActions";
import { ValidationError } from "../../../src/db/errors";

describe("busy state", () => {
  it("is true only for the action that is running", () => {
    const state: BusyState = "download";
    expect(isBusy(state, "download")).toBe(true);
    expect(isBusy(state, "send")).toBe(false);
    expect(isBusy(state, "pay")).toBe(false);
    expect(isBusy(state, "status")).toBe(false);
  });

  it("is false for every action when the page is idle", () => {
    const state: BusyState = null;
    expect(isBusy(state, "download")).toBe(false);
    expect(isBusy(state, "send")).toBe(false);
    expect(anyBusy(state)).toBe(false);
  });

  it("reports that something is running without saying what", () => {
    expect(anyBusy("send")).toBe(true);
    expect(anyBusy("saveLines")).toBe(true);
  });
});

describe("status choices", () => {
  it("lets a draft invoice be moved to sent by hand", () => {
    expect(statusChoices("invoice", "draft")).toEqual([
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent" },
    ]);
  });

  it("lets a sent invoice be marked paid by hand", () => {
    expect(statusChoices("invoice", "sent")).toEqual([
      { value: "sent", label: "Sent" },
      { value: "paid", label: "Paid" },
    ]);
  });

  it("offers a sent quote both answers", () => {
    expect(statusChoices("quote", "sent")).toEqual([
      { value: "sent", label: "Sent" },
      { value: "accepted", label: "Accepted" },
      { value: "declined", label: "Declined" },
    ]);
  });

  it("never offers void, which keeps its own confirmed button", () => {
    for (const status of ["draft", "sent"]) {
      for (const kind of ["invoice", "quote"]) {
        expect(statusChoices(kind, status).map((choice) => choice.value)).not.toContain("void");
      }
    }
  });

  it("leaves a written-off document with nothing but the status it has", () => {
    // Void is the one end state. Paid is not: marking the wrong invoice paid
    // used to be permanent, so the control offers the way back (F-LB-4).
    expect(statusIsFixed("invoice", "void")).toBe(true);
    expect(statusIsFixed("quote", "declined")).toBe(true);
  });

  it("offers a paid invoice the way back, with the current status first", () => {
    const choices = statusChoices("invoice", "paid");
    expect(choices[0]).toEqual({ value: "paid", label: "Paid" });
    expect(choices.map((choice) => choice.value)).toContain("sent");
    expect(statusIsFixed("invoice", "paid")).toBe(false);
  });

  it("does not call a movable document fixed", () => {
    expect(statusIsFixed("invoice", "draft")).toBe(false);
    expect(statusIsFixed("quote", "sent")).toBe(false);
  });
});

describe("fieldIssue", () => {
  it("finds the message for one field on a ValidationError - the overpayment refusal names the balance", () => {
    const err = new ValidationError("$700.00 is left on INV-1, so $800.00 is more than the balance.", [
      { path: "amountCents", message: "Record $700.00 or less, or split it across the invoices it covers." },
    ]);
    expect(fieldIssue(err, "amountCents")).toBe(
      "Record $700.00 or less, or split it across the invoices it covers.",
    );
  });

  it("is undefined when that field has no issue", () => {
    const err = new ValidationError("Some of those details need fixing.", [
      { path: "paidOn", message: "A payment cannot be dated in the future." },
    ]);
    expect(fieldIssue(err, "amountCents")).toBeUndefined();
    expect(fieldIssue(err, "paidOn")).toBe("A payment cannot be dated in the future.");
  });

  it("is undefined for anything that is not a ValidationError", () => {
    expect(fieldIssue(new Error("boom"), "amountCents")).toBeUndefined();
    expect(fieldIssue("boom", "amountCents")).toBeUndefined();
    expect(fieldIssue(null, "amountCents")).toBeUndefined();
  });
});
