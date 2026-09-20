import { describe, expect, it } from "vitest";
import { billToTitle, resolveBillTo, type BillToParty } from "@/features/invoices/lib/billTo";

describe("resolveBillTo", () => {
  it("uses the contact's name as the title and lists the company as the first detail (today's behaviour)", () => {
    const party: BillToParty = {
      contactName: "Dale Petrov",
      companyName: "Ridgeway Farms",
      email: "dale@ridgewayfarms.example",
      phone: "(217) 555-0188",
      address: "88 Harrow Lane\nChatham, IL 62629",
    };

    const result = resolveBillTo(party);

    expect(result.title).toBe("Dale Petrov");
    expect(result.details).toEqual([
      "Ridgeway Farms",
      "88 Harrow Lane",
      "Chatham, IL 62629",
      "dale@ridgewayfarms.example",
      "(217) 555-0188",
    ]);
  });

  it("falls back to the company as the title when there is no contact name, and does not repeat the company", () => {
    const party: BillToParty = {
      contactName: null,
      companyName: "Ridgeway Farms",
      email: "office@ridgewayfarms.example",
      phone: null,
      address: null,
    };

    const result = resolveBillTo(party);

    expect(result.title).toBe("Ridgeway Farms");
    expect(result.details).toEqual(["office@ridgewayfarms.example"]);
    expect(result.details).not.toContain("Ridgeway Farms");
  });

  it("prints no blank first line when the contact has no name (a company with an address and phone)", () => {
    const party: BillToParty = {
      companyName: "Ridgeway Farms",
      address: "88 Harrow Lane",
      phone: "555-0188",
    };

    const result = resolveBillTo(party);

    expect(result.title).toBe("Ridgeway Farms");
    expect(result.title.trim()).not.toBe("");
    expect(result.details).toEqual(["88 Harrow Lane", "555-0188"]);
  });

  it("falls back to the email as the title when there is neither a name nor a company, and does not repeat the email", () => {
    const party: BillToParty = {
      contactName: "",
      companyName: "",
      email: "someone@example.com",
      phone: "555-0100",
      address: null,
    };

    const result = resolveBillTo(party);

    expect(result.title).toBe("someone@example.com");
    expect(result.details).toEqual(["555-0100"]);
    expect(result.details).not.toContain("someone@example.com");
  });

  it("falls back to 'No customer yet' when there is nothing at all", () => {
    const result = resolveBillTo({});
    expect(result.title).toBe("No customer yet");
    expect(result.details).toEqual([]);
  });

  it("treats whitespace-only fields as empty everywhere", () => {
    const party: BillToParty = {
      contactName: "   ",
      companyName: "  ",
      email: "  ",
      phone: "   ",
      address: "  \n   \n  ",
    };

    const result = resolveBillTo(party);

    expect(result.title).toBe("No customer yet");
    expect(result.details).toEqual([]);
  });

  it("drops blank lines out of a multi-line address and trims each remaining line", () => {
    const party: BillToParty = {
      contactName: "Dale Petrov",
      address: "  88 Harrow Lane  \n\n   \nChatham, IL 62629\n",
    };

    const result = resolveBillTo(party);

    expect(result.details).toEqual(["88 Harrow Lane", "Chatham, IL 62629"]);
  });

  it("never produces a blank entry in details", () => {
    const party: BillToParty = {
      contactName: "Dale Petrov",
      companyName: "  ",
      email: "   ",
      phone: "",
      address: "\n\n",
    };

    const result = resolveBillTo(party);

    expect(result.details).toEqual([]);
    for (const line of result.details) expect(line.trim()).not.toBe("");
  });
});

describe("billToTitle", () => {
  it("agrees with resolveBillTo's title for the same input", () => {
    const party: BillToParty = { contactName: "", companyName: "Ridgeway Farms" };
    expect(billToTitle(party)).toBe(resolveBillTo(party).title);
  });

  it("is never empty, even for a party with nothing on it", () => {
    expect(billToTitle({})).toBe("No customer yet");
  });
});
