import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail, emailLower } from "@/lib/email";

describe("email", () => {
  describe("normalizeEmail", () => {
    it("trims and lowercases for the lower field", () => {
      const result = normalizeEmail("  Jane.Doe@Example.COM  ");
      expect(result.raw).toBe("Jane.Doe@Example.COM");
      expect(result.lower).toBe("jane.doe@example.com");
      expect(result.valid).toBe(true);
    });

    it("returns empty/invalid for empty input", () => {
      expect(normalizeEmail("")).toEqual({ raw: "", lower: "", valid: false });
      expect(normalizeEmail("   ")).toEqual({ raw: "", lower: "", valid: false });
    });

    it("marks an invalid email as invalid but still normalizes case", () => {
      const result = normalizeEmail("not-an-email");
      expect(result.raw).toBe("not-an-email");
      expect(result.lower).toBe("not-an-email");
      expect(result.valid).toBe(false);
    });

    it("never throws on garbage input", () => {
      expect(() => normalizeEmail("@@@")).not.toThrow();
      expect(() => normalizeEmail("a@b@c")).not.toThrow();
    });
  });

  describe("isValidEmail", () => {
    it("accepts a plain valid email", () => {
      expect(isValidEmail("owner@trampolines.com")).toBe(true);
    });

    it("accepts a subdomain and plus-tag", () => {
      expect(isValidEmail("owner+leads@mail.trampolines.com")).toBe(true);
    });

    it("rejects more than one @", () => {
      expect(isValidEmail("a@b@example.com")).toBe(false);
    });

    it("rejects an empty local part", () => {
      expect(isValidEmail("@example.com")).toBe(false);
    });

    it("rejects a domain with no dot", () => {
      expect(isValidEmail("owner@localhost")).toBe(false);
    });

    it("rejects a domain with a leading or trailing dot", () => {
      expect(isValidEmail("owner@.example.com")).toBe(false);
      expect(isValidEmail("owner@example.com.")).toBe(false);
    });

    it("rejects consecutive dots in the domain", () => {
      expect(isValidEmail("owner@example..com")).toBe(false);
    });

    it("rejects a TLD shorter than 2 characters", () => {
      expect(isValidEmail("owner@example.c")).toBe(false);
    });

    it("rejects whitespace anywhere in the address", () => {
      expect(isValidEmail("owner @example.com")).toBe(false);
      expect(isValidEmail("owner@ example.com")).toBe(false);
    });

    it("rejects empty input", () => {
      expect(isValidEmail("")).toBe(false);
    });

    it("is case-insensitive about validity (uppercase is still valid)", () => {
      expect(isValidEmail("Owner@Example.COM")).toBe(true);
    });
  });

  describe("emailLower", () => {
    it("trims and lowercases", () => {
      expect(emailLower("  Owner@Example.COM  ")).toBe("owner@example.com");
    });

    it("returns empty string for empty input", () => {
      expect(emailLower("")).toBe("");
    });
  });
});
