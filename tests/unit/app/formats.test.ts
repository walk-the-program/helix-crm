/**
 * `makeFormats` — the logic behind `useFormats` (src/app/formats.ts).
 *
 * The bug this exists to stop coming back (F-LC-1): a workspace set to
 * Canadian dollars and en-GB rendered "$0.00" and "Mar 14, 2026" because the
 * call site passed neither the currency nor the locale. Every assertion below
 * is about the values actually reaching Intl.
 */
import { describe, expect, it } from "vitest";
import {
  FALLBACK_CURRENCY,
  FALLBACK_LOCALE,
  FALLBACK_REGION,
  makeFormats,
} from "@/app/formats";

/** Intl uses a non-breaking space in some locales; compare without caring. */
function plain(value: string): string {
  return value.replace(/ | /g, " ");
}

describe("makeFormats", () => {
  it("formats money in the workspace's currency and locale", () => {
    const f = makeFormats({ currency: "CAD", locale: "en-GB" });
    expect(plain(f.money(1245000))).toBe("CA$12,450.00");
  });

  it("formats dates in the workspace's locale", () => {
    const us = makeFormats({ currency: "USD", locale: "en-US" });
    const gb = makeFormats({ currency: "GBP", locale: "en-GB" });
    expect(us.date("2026-03-14")).toBe("Mar 14, 2026");
    expect(gb.date("2026-03-14")).toBe("14 Mar 2026");
    // The whole point: the two disagree, so the locale is genuinely reaching Intl.
    expect(us.date("2026-03-14")).not.toBe(gb.date("2026-03-14"));
  });

  it("formats timestamps in the workspace's locale", () => {
    const gb = makeFormats({ currency: "GBP", locale: "en-GB" });
    const rendered = plain(gb.dateTime("2026-03-14T09:30:00.000Z"));
    expect(rendered).toContain("14 Mar 2026");
    expect(rendered).toMatch(/\d{1,2}:\d{2}/);
  });

  it("abbreviates large figures but keeps the currency", () => {
    const f = makeFormats({ currency: "CAD", locale: "en-CA" });
    const rendered = plain(f.moneyCompact(120_000_00));
    expect(rendered).toContain("$");
    expect(rendered).toMatch(/120K|120,000/);
    // Under the compact threshold it is the plain form.
    expect(plain(f.moneyCompact(1_00))).toBe(plain(f.money(1_00)));
  });

  it("lets one call override the currency without changing the rest", () => {
    const f = makeFormats({ currency: "CAD", locale: "en-GB" });
    // en-GB writes US dollars as "US$", Canadian as "CA$": the override reached
    // Intl, and the locale stayed the workspace's.
    expect(plain(f.money(1000, "USD"))).toBe("US$10.00");
    expect(plain(f.money(1000))).toBe("CA$10.00");
  });

  it("falls back to the repository's own defaults before the query resolves", () => {
    const f = makeFormats({});
    expect(f.currency).toBe(FALLBACK_CURRENCY);
    expect(f.locale).toBe(FALLBACK_LOCALE);
    expect(f.region).toBe(FALLBACK_REGION);
    expect(plain(f.money(1245000))).toBe("$12,450.00");
  });

  it("treats an empty string as absent rather than as a locale", () => {
    const f = makeFormats({ currency: "", locale: "", region: "" });
    expect(f.currency).toBe(FALLBACK_CURRENCY);
    expect(f.locale).toBe(FALLBACK_LOCALE);
    expect(plain(f.money(0))).toBe("$0.00");
  });

  it("carries the phone region through untouched", () => {
    expect(makeFormats({ region: "GB" }).region).toBe("GB");
  });

  it("returns an empty string for a missing date rather than throwing", () => {
    const f = makeFormats({ locale: "en-GB" });
    expect(f.date(null)).toBe("");
    expect(f.date(undefined)).toBe("");
    expect(f.dateTime(null)).toBe("");
    expect(f.date("not a date")).toBe("");
  });

  it("survives a currency Intl does not know", () => {
    const f = makeFormats({ currency: "ZZZ", locale: "en-US" });
    expect(() => f.money(100)).not.toThrow();
    expect(f.money(100)).toContain("1");
  });
});
