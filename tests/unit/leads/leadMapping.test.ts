import { describe, it, expect } from "vitest";
import {
  normaliseOrigin,
  externalIdFor,
  splitLeadName,
  dealTitleFor,
  systemActivityBody,
  mapLead,
} from "@/features/leads/lib/leadMapping";
import type { Lead } from "@/features/leads/lib/types";

/** A lead with every field present, overridden per test. */
function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    createdAt: "2026-03-01T12:00:00.000Z",
    name: null,
    email: null,
    phone: null,
    service: null,
    message: null,
    pageUrl: null,
    ...overrides,
  };
}

describe("leadMapping", () => {
  describe("normaliseOrigin", () => {
    it("strips a trailing slash and lowercases the scheme and host", () => {
      expect(normaliseOrigin("https://Sorensenlandscaping.COM/")).toBe(
        "https://sorensenlandscaping.com",
      );
    });

    it("strips multiple trailing slashes", () => {
      expect(normaliseOrigin("https://x.com///")).toBe("https://x.com");
    });

    it("keeps the port", () => {
      expect(normaliseOrigin("http://127.0.0.1:4711")).toBe(
        "http://127.0.0.1:4711",
      );
    });

    it("survives a non-URL string instead of throwing", () => {
      expect(normaliseOrigin("Not A URL")).toBe("not a url");
    });
  });

  describe("externalIdFor", () => {
    it("joins the normalised origin and the lead id with a colon", () => {
      expect(externalIdFor("https://x.com", "lead-42")).toBe(
        "https://x.com:lead-42",
      );
    });

    it("produces the same id for the same lead whether or not the origin has a trailing slash", () => {
      // This is what makes a re-poll idempotent (leadMapping.ts doc comment).
      const withSlash = externalIdFor("https://X.com/", "lead-42");
      const withoutSlash = externalIdFor("https://X.com", "lead-42");
      expect(withSlash).toBe(withoutSlash);
    });
  });

  describe("splitLeadName", () => {
    it("splits on the last space, keeping a middle name with the first", () => {
      const { firstName, lastName } = splitLeadName(
        makeLead({ name: "Mary Anne Sorensen" }),
      );
      expect(firstName).toBe("Mary Anne");
      expect(lastName).toBe("Sorensen");
    });

    it("puts a single word entirely in the first name", () => {
      const { firstName, lastName } = splitLeadName(makeLead({ name: "Madonna" }));
      expect(firstName).toBe("Madonna");
      expect(lastName).toBe("");
    });

    it("collapses extra whitespace before splitting", () => {
      const { firstName, lastName } = splitLeadName(
        makeLead({ name: "  Mary   Anne   Sorensen  " }),
      );
      expect(firstName).toBe("Mary Anne");
      expect(lastName).toBe("Sorensen");
    });

    it("falls back to the email's local part when there is no name", () => {
      const { firstName, lastName } = splitLeadName(
        makeLead({ name: null, email: "bob@example.com" }),
      );
      expect(firstName).toBe("bob");
      expect(lastName).toBe("");
    });

    it("falls back to 'Website lead' when there is neither a name nor an email", () => {
      const { firstName, lastName } = splitLeadName(makeLead());
      expect(firstName).toBe("Website lead");
      expect(lastName).toBe("");
    });
  });

  describe("dealTitleFor", () => {
    it("combines service and person when both are present", () => {
      expect(
        dealTitleFor(makeLead({ service: "Lawn care", name: "Bob Sorensen" })),
      ).toBe("Lawn care - Bob Sorensen");
    });

    it("falls back to the service alone when the visitor gave no name", () => {
      // splitLeadName's "Website lead" placeholder must not leak into a title:
      // a form with a service and no name reads "Lawn care", never
      // "Lawn care - Website lead".
      expect(
        dealTitleFor(makeLead({ name: null, email: null, service: "Lawn care" })),
      ).toBe("Lawn care");
      expect(
        dealTitleFor(makeLead({ name: "   ", email: "", service: "Lawn care" })),
      ).toBe("Lawn care");
    });

    it("falls back to the person alone when there is no service", () => {
      expect(dealTitleFor(makeLead({ name: "Bob Sorensen" }))).toBe(
        "Bob Sorensen",
      );
    });

    it("falls back to 'Website lead' when there is neither", () => {
      expect(dealTitleFor(makeLead())).toBe("Website lead");
    });
  });

  describe("systemActivityBody", () => {
    it("always starts with the 'Lead from the website.' line", () => {
      expect(systemActivityBody(makeLead())).toMatch(/^Lead from the website\./);
    });

    it("includes the Service, Message and Page lines when present", () => {
      const body = systemActivityBody(
        makeLead({
          service: "Lawn care",
          message: "Please call after 5pm.",
          pageUrl: "https://sorensenlandscaping.com/contact",
        }),
      );
      expect(body).toContain("Service: Lawn care");
      expect(body).toContain("Message: Please call after 5pm.");
      expect(body).toContain("Page: https://sorensenlandscaping.com/contact");
    });

    it("omits the Service, Message and Page lines when null", () => {
      const body = systemActivityBody(makeLead());
      expect(body).not.toContain("Service:");
      expect(body).not.toContain("Message:");
      expect(body).not.toContain("Page:");
    });

    it("omits the Service, Message and Page lines when blank", () => {
      const body = systemActivityBody(
        makeLead({ service: "  ", message: "   ", pageUrl: "" }),
      );
      expect(body).not.toContain("Service:");
      expect(body).not.toContain("Message:");
      expect(body).not.toContain("Page:");
    });

    it("keeps the original message text verbatim, including newlines the visitor typed", () => {
      const message = "Line one\nLine two\n\nLine four";
      const body = systemActivityBody(makeLead({ message }));
      expect(body).toContain(`Message: ${message}`);
    });
  });

  describe("mapLead", () => {
    it("turns a blank email into null so it never reaches the dedupe query as an empty string", () => {
      expect(mapLead(makeLead({ email: "  " }), "https://x.com").email).toBeNull();
    });

    it("turns a blank phone into null so it never reaches the dedupe query as an empty string", () => {
      expect(mapLead(makeLead({ phone: "  " }), "https://x.com").phone).toBeNull();
    });

    it("keeps a real email and phone", () => {
      const mapped = mapLead(
        makeLead({ email: "bob@example.com", phone: "555-0100" }),
        "https://x.com",
      );
      expect(mapped.email).toBe("bob@example.com");
      expect(mapped.phone).toBe("555-0100");
    });

    it("uses the site's createdAt as occurredAt, not the current time", () => {
      const lead = makeLead({ createdAt: "2020-01-01T00:00:00.000Z" });
      expect(mapLead(lead, "https://x.com").occurredAt).toBe(
        "2020-01-01T00:00:00.000Z",
      );
    });
  });
});
