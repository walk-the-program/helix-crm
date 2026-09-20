/**
 * The small decisions the record pickers and the timeline make, tested apart
 * from React: what a typed name becomes, which company follows a contact, and
 * what each timeline chip shows.
 */
import { describe, expect, it } from "vitest";
import {
  companyAfterContactPick,
  splitTypedName,
  type PickedContact,
} from "../../../src/features/records/components/Pickers";
import { matchesTimelineFilter } from "../../../src/features/records/components/Timeline";

function picked(companyId: string | null): PickedContact {
  return { id: "c1", label: "Priya Raman", companyId, companyName: companyId && "Acme" };
}

describe("splitTypedName", () => {
  it("reads one word as a first name", () => {
    expect(splitTypedName("Priya")).toEqual({ firstName: "Priya", lastName: "" });
  });

  it("reads the rest as the last name, however many words it is", () => {
    expect(splitTypedName("Priya Raman")).toEqual({
      firstName: "Priya",
      lastName: "Raman",
    });
    expect(splitTypedName("Ada King Lovelace")).toEqual({
      firstName: "Ada",
      lastName: "King Lovelace",
    });
  });

  it("survives stray whitespace", () => {
    expect(splitTypedName("  Priya   Raman  ")).toEqual({
      firstName: "Priya",
      lastName: "Raman",
    });
    expect(splitTypedName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("companyAfterContactPick", () => {
  it("fills the company from the contact", () => {
    expect(companyAfterContactPick(picked("co1"), null)).toBe("co1");
  });

  it("replaces a company already chosen, because the person is the newer answer", () => {
    expect(companyAfterContactPick(picked("co1"), "co-old")).toBe("co1");
  });

  it("leaves the chosen company alone when the contact has none", () => {
    expect(companyAfterContactPick(picked(null), "co-old")).toBe("co-old");
  });

  it("changes nothing when the contact was cleared", () => {
    expect(companyAfterContactPick(null, "co-old")).toBe("co-old");
    expect(companyAfterContactPick(undefined, null)).toBeNull();
  });
});

describe("matchesTimelineFilter", () => {
  it("shows everything under All", () => {
    expect(matchesTimelineFilter("note", "all")).toBe(true);
    expect(matchesTimelineFilter("system", "all")).toBe(true);
  });

  it("separates what a person wrote from what the app recorded", () => {
    expect(matchesTimelineFilter("call", "human")).toBe(true);
    expect(matchesTimelineFilter("system", "human")).toBe(false);
    expect(matchesTimelineFilter("system", "system")).toBe(true);
    expect(matchesTimelineFilter("note", "system")).toBe(false);
  });
});
