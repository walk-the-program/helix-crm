import { describe, it, expect } from "vitest";
import {
  normaliseOrigin,
  externalIdFor,
  splitLeadName,
  dealTitleFor,
  systemActivityBody,
  mapLead,
  hasUsableId,
  activityDetail,
  LEAD_UPDATE_INTRO,
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

  describe("hasUsableId (F-LB-1 / F-LB-8)", () => {
    it("accepts a non-blank string", () => {
      expect(hasUsableId("lead-42")).toBe(true);
      expect(hasUsableId("  lead-42  ")).toBe(true);
    });

    it("rejects a blank or whitespace-only string", () => {
      expect(hasUsableId("")).toBe(false);
      expect(hasUsableId("   ")).toBe(false);
    });

    it("rejects anything that is not a string", () => {
      expect(hasUsableId(undefined)).toBe(false);
      expect(hasUsableId(null)).toBe(false);
      expect(hasUsableId(42)).toBe(false);
      expect(hasUsableId({})).toBe(false);
    });
  });

  describe("activityDetail (F-LB-17)", () => {
    it("returns everything after the first line", () => {
      expect(activityDetail("Lead from the website.\nService: Lawn care")).toBe(
        "Service: Lawn care",
      );
    });

    it("returns '' when the body is a single line", () => {
      expect(activityDetail("Lead from the website.")).toBe("");
    });

    it("keeps multi-line detail (a message with its own newlines) intact", () => {
      const body = "Lead from the website.\nMessage: line one\nline two\nPage: https://x.com";
      expect(activityDetail(body)).toBe("Message: line one\nline two\nPage: https://x.com");
    });

    it("treats the original intro and the update intro the same way", () => {
      const original = activityDetail(`Lead from the website.\nService: Lawn care`);
      const update = activityDetail(`${LEAD_UPDATE_INTRO}\nService: Lawn care`);
      expect(original).toBe(update);
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
