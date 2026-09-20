/**
 * F-LB-22: `documents.createFromDeal` throws a `ValidationError` whose FIELD
 * message ("This deal has no services on it yet. Add one first.") is the
 * half that actually tells the owner what to do; the top-level message
 * ("There is nothing to put on this document.") is the generic one. The
 * panel's toast has to prefer the field message when there is one.
 */
import { describe, it, expect } from "vitest";
import { resolveErrorMessage } from "@/features/invoices/components/DealInvoicesPanel";
import { ValidationError, NotFoundError } from "@/db/errors";

describe("resolveErrorMessage", () => {
  it("prefers the field message off a ValidationError's first issue over its generic top-level message", () => {
    const err = new ValidationError("There is nothing to put on this document.", [
      { path: "items", message: "This deal has no services on it yet. Add one first." },
    ]);
    expect(resolveErrorMessage(err, "That quote could not be created.")).toBe(
      "This deal has no services on it yet. Add one first.",
    );
  });

  it("uses the recurring-specific field message for a recurring-only selection", () => {
    const err = new ValidationError("There is nothing to put on this document.", [
      { path: "items", message: "This deal has no monthly or yearly services on it." },
    ]);
    expect(resolveErrorMessage(err, "fallback")).toBe(
      "This deal has no monthly or yearly services on it.",
    );
  });

  it("a ValidationError with no issues still shows its own top-level message", () => {
    const err = new ValidationError("Something about this deal is invalid.", []);
    expect(resolveErrorMessage(err, "fallback")).toBe("Something about this deal is invalid.");
  });

  it("any other real Error shows its own message (success path unaffected)", () => {
    const err = new NotFoundError("deal", "deal-1");
    expect(resolveErrorMessage(err, "fallback")).toBe(err.message);
  });

  it("a non-Error thrown value falls back to the caller's fallback text", () => {
    expect(resolveErrorMessage("nope", "That invoice could not be created.")).toBe(
      "That invoice could not be created.",
    );
  });

  it("an Error with a blank message falls back rather than showing nothing", () => {
    expect(resolveErrorMessage(new Error("   "), "fallback text")).toBe("fallback text");
  });
});
