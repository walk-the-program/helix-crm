import { describe, expect, it } from "vitest";
import { hrefFor, mailtoHref, smsHref, telHref } from "@/features/records/lib/links";

describe("telHref", () => {
  it("keeps digits and a leading plus and drops the rest", () => {
    expect(telHref("(801) 555-0147")).toBe("tel:8015550147");
    expect(telHref("+1 801 555 0147")).toBe("tel:+18015550147");
    expect(telHref("801.555.0147 ext 2")).toBe("tel:80155501472");
  });
});

describe("smsHref", () => {
  it("uses the same digits", () => {
    expect(smsHref("(801) 555-0147")).toBe("sms:8015550147");
  });
});

describe("mailtoHref", () => {
  it("encodes the address", () => {
    expect(mailtoHref("brent@example.com")).toBe("mailto:brent%40example.com");
    expect(mailtoHref("  brent+jobs@example.com ")).toBe("mailto:brent%2Bjobs%40example.com");
  });
});

describe("hrefFor", () => {
  it("routes each kind to its scheme", () => {
    expect(hrefFor("call", "8015550147")).toBe("tel:8015550147");
    expect(hrefFor("text", "8015550147")).toBe("sms:8015550147");
    expect(hrefFor("email", "a@b.com")).toBe("mailto:a%40b.com");
  });

  it("has no scheme of its own for a map: the address builds that", () => {
    expect(hrefFor("map", "somewhere")).toBeNull();
  });

  it("returns null for an empty value", () => {
    expect(hrefFor("call", "   ")).toBeNull();
  });
});
