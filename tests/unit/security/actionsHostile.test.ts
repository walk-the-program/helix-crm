/**
 * LR-SEC-W2, items 1 and 2: hostile-input coverage for src/lib/actions.ts.
 *
 * The pre-existing tests/unit/actions.test.ts is left untouched. This file
 * covers:
 *  - safeExternalUrl (new): the scheme allow-list CompanyPage's website link
 *    now runs through instead of a raw <a href>.
 *  - telHref/smsHref/mailtoHref against the hostile values named in the
 *    security packet, including mail-header CRLF injection.
 */
import { describe, expect, it } from "vitest";
import { mailtoHref, safeExternalUrl, smsHref, telHref } from "@/lib/actions";

describe("safeExternalUrl: scheme allow-list", () => {
  it("upgrades a bare domain to https", () => {
    const result = safeExternalUrl("example.com");
    expect(result).toEqual({ ok: true, url: "https://example.com/" });
  });

  it("keeps an explicit https URL", () => {
    const result = safeExternalUrl("https://example.com/path?x=1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/path?x=1");
  });

  it("keeps an explicit http URL", () => {
    const result = safeExternalUrl("http://example.com");
    expect(result.ok).toBe(true);
  });

  it("upgrades a bare domain with a port and path (a colon that is not a scheme)", () => {
    const result = safeExternalUrl("example.com:8080/status");
    expect(result).toEqual({ ok: true, url: "https://example.com:8080/status" });
  });

  const refusedInputs = [
    "javascript:alert(1)",
    " javascript:alert(1)", // leading space
    "JaVaScRiPt:alert(1)", // mixed case
    "java\tscript:alert(1)", // tab splitting the scheme
    "java\nscript:alert(1)", // newline splitting the scheme
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://example.com/uuid",
    "//evil.com",
  ];

  for (const input of refusedInputs) {
    it(`refuses ${JSON.stringify(input)}`, () => {
      const result = safeExternalUrl(input);
      expect(result.ok).toBe(false);
    });
  }

  it("trims a trailing newline off an otherwise legitimate URL rather than refusing it", () => {
    const result = safeExternalUrl("https://example.com\n");
    expect(result).toEqual({ ok: true, url: "https://example.com/" });
  });

  it("returns a readable message rather than throwing, for garbage input", () => {
    expect(() => safeExternalUrl("javascript:alert(1)")).not.toThrow();
    const result = safeExternalUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toMatch(/error|exception|undefined/i);
    }
  });

  it("reports no website saved for an empty value, rather than opening nothing", () => {
    const result = safeExternalUrl("   ");
    expect(result.ok).toBe(false);
  });
});

describe("telHref: hostile phone value", () => {
  it("strips everything but digits and a leading +, so markup cannot survive", () => {
    expect(telHref('+1-555-0100"><script>')).toBe("tel:+15550100");
  });
});

describe("mailtoHref: hostile address, subject and body", () => {
  it("percent-encodes the address itself, not just the params - extra query params cannot be smuggled in", () => {
    const href = mailtoHref("a@b.com?to=attacker@evil.com&subject=x");
    // The whole address, including the attacker's "?to=...&subject=..." tail,
    // is inside the encoded address segment: no bare "?" starts a real query.
    expect(href.startsWith("mailto:")).toBe(true);
    const afterScheme = href.slice("mailto:".length);
    expect(afterScheme.includes("?")).toBe(false);
    expect(decodeURIComponent(afterScheme)).toBe("a@b.com?to=attacker@evil.com&subject=x");
  });

  it("strips a literal CRLF out of the address before it is ever encoded", () => {
    const href = mailtoHref("a@b.com\r\nBcc:attacker@evil.com");
    expect(href).not.toMatch(/\r|\n/);
    expect(decodeURIComponent(href.slice("mailto:".length))).toBe(
      "a@b.comBcc:attacker@evil.com",
    );
  });

  it("strips a percent-encoded-looking literal CRLF the same way (no double-decode surprises)", () => {
    // The attacker sends the literal string "%0ABcc:..." (not an actual
    // newline byte) - encodeURIComponent turns the leading "%" into "%25",
    // which is inert; nothing about it should be treated as a real newline.
    const href = mailtoHref("a@b.com%0ABcc:attacker@evil.com");
    expect(decodeURIComponent(href.slice("mailto:".length))).toBe(
      "a@b.com%0ABcc:attacker@evil.com",
    );
  });

  it("handles an address that is only a newline: trims and encodes to nothing", () => {
    expect(mailtoHref("\n")).toBe("mailto:");
  });

  it("handles a 100 kB address without throwing or hanging", () => {
    const big = "a".repeat(100_000) + "@example.com";
    const href = mailtoHref(big);
    expect(href.startsWith("mailto:")).toBe(true);
    expect(decodeURIComponent(href.slice("mailto:".length))).toBe(big);
  });

  it("percent-encodes (rather than strips) a CRLF in the subject or body - a real newline in the message text is not the header-injection vector", () => {
    // Only the recipient ADDRESS is where a mail client could re-inject a
    // decoded newline into a header line it builds itself. The subject and
    // body decode back into ordinary message text, and a template's blank
    // line between paragraphs depends on that newline surviving intact
    // (tests/unit/templates/send.test.ts pins the round-trip already) - so
    // this file does not touch that behaviour, only proves it is unchanged.
    const href = mailtoHref("a@b.com", {
      subject: "hi\r\nBcc:attacker@evil.com",
      body: "line one\r\nBcc:attacker@evil.com",
    });
    expect(href).not.toMatch(/\r|\n/); // no RAW control character in the URL itself
    expect(href).toContain("subject=hi%0D%0ABcc%3Aattacker%40evil.com");
    expect(href).toContain("body=line%20one%0D%0ABcc%3Aattacker%40evil.com");
  });
});

describe("smsHref: hostile body", () => {
  it("percent-encodes a CRLF in the body rather than stripping it, same reasoning as mailtoHref", () => {
    const href = smsHref("8015550147", { body: "hi\r\nBcc:attacker@evil.com" });
    expect(href).not.toMatch(/\r|\n/); // no RAW control character in the URL itself
    expect(href).toContain("body=hi%0D%0ABcc%3Aattacker%40evil.com");
  });
});
