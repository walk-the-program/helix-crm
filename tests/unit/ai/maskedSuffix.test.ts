/**
 * The masked suffix: the only part of a key that is ever written outside the
 * keychain, and the sentence built from it.
 */
import { describe, expect, it } from "vitest";
import {
  describeStoredKey,
  maskedSuffix,
} from "../../../src/features/ai/lib/aiSettings";

describe("maskedSuffix", () => {
  it("keeps the last four characters and nothing else", () => {
    expect(maskedSuffix("sk-ant-api03-AAAAbbbbCCCC1234")).toBe("1234");
  });

  it("never returns the prefix that identifies the account", () => {
    const key = "sk-ant-api03-verysecretmaterial9876";
    const suffix = maskedSuffix(key) ?? "";
    expect(suffix).toHaveLength(4);
    expect(key.startsWith(suffix)).toBe(false);
    expect(key.slice(0, key.length - 4)).not.toContain(suffix);
  });

  it("trims, and answers null for nothing at all", () => {
    expect(maskedSuffix("  sk-ant-9999  ")).toBe("9999");
    expect(maskedSuffix("")).toBeNull();
    expect(maskedSuffix("   ")).toBeNull();
  });

  it("never returns more than four characters, even for a short key", () => {
    expect(maskedSuffix("ab")).toBe("ab");
    expect((maskedSuffix("abcdef") ?? "").length).toBe(4);
  });
});

describe("describeStoredKey", () => {
  it("says nothing is saved when nothing is", () => {
    expect(describeStoredKey("unset", null)).toBe("No key saved.");
    expect(describeStoredKey("unset", "1234")).toBe("No key saved.");
  });

  it("names only the last four when one is saved", () => {
    expect(describeStoredKey("saved", "1234")).toBe("Saved, ends in 1234.");
  });

  it("says so when Anthropic rejected it", () => {
    expect(describeStoredKey("rejected", "1234")).toContain("rejected");
    expect(describeStoredKey("rejected", "1234")).toContain("1234");
  });

  it("falls back rather than claiming a key with no suffix", () => {
    expect(describeStoredKey("saved", null)).toBe("No key saved.");
  });
});
