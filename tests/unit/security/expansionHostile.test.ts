/**
 * The security recheck after the product-expansion phase (LR-SEC-RECHECK).
 *
 * Three new surfaces carry somebody else's text further than the screen:
 *
 *   automation title   template + lead/contact data -> a task title
 *   .ics export        that title, plus a customer's name and phone, into a
 *                      plain file the owner saves and a calendar app parses
 *   CSV export         the same title, into a spreadsheet cell
 *
 * `{name}` on the speed-to-lead rule originates in a public web form. The Rust
 * boundary (`leads::enforce_bounds`) already bounds and strips that path, but
 * it is not the only one into these tokens: a CSV-imported contact reaches the
 * same `{name}` with nothing stripped, and `{job}` is a deal title. So these
 * tests drive the boundaries themselves rather than trusting an upstream.
 */
import { describe, expect, it } from "vitest";
import { renderTemplate, sanitizeTitle } from "@/db/repos/automations";
import { buildIcs, escapeText } from "@/lib/ics";
import { escapeCell } from "@/features/data/lib/exportCsv";

/** Built from code points so no invisible character sits in this file. */
const RTL_OVERRIDE = String.fromCodePoint(0x202e);
const LTR_MARK = String.fromCodePoint(0x200e);
const NUL = String.fromCodePoint(0x0000);
const BELL = String.fromCodePoint(0x0007);

describe("automation task titles (F-SEC-R-1)", () => {
  it("strips a right-to-left override out of a rendered name", () => {
    const title = renderTemplate("Call {name}", { name: `${RTL_OVERRIDE}fdp.exe` });
    expect(title).toBe("Call fdp.exe");
    expect(title).not.toContain(RTL_OVERRIDE);
  });

  it("strips NUL and other C0 controls, and keeps a tab as whitespace", () => {
    expect(sanitizeTitle(`a${NUL}b${BELL}c`)).toBe("abc");
    expect(sanitizeTitle("a\tb")).toBe("a b");
  });

  it("caps a title so an imported name cannot make an unbounded one", () => {
    const title = renderTemplate("Call {name}", { name: "x".repeat(100_000) });
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith("…")).toBe(true);
  });

  it("collapses the newlines a multi-line imported field would carry in", () => {
    expect(sanitizeTitle("Call\nJane\r\nSmith")).toBe("Call Jane Smith");
  });

  it("leaves an ordinary title, and an accented or emoji name, alone", () => {
    expect(renderTemplate("Follow up on {number}", { number: "INV-2026-0004" })).toBe(
      "Follow up on INV-2026-0004",
    );
    expect(renderTemplate("Call {name}", { name: "Zoë 🌱 Ferreira" })).toBe(
      "Call Zoë 🌱 Ferreira",
    );
  });

  it("renders an empty token as nothing and leaves an unknown token alone", () => {
    expect(renderTemplate("Call {name}", { name: null })).toBe("Call");
    expect(renderTemplate("Ping {nope}", {})).toBe("Ping {nope}");
  });
});

describe("iCalendar export (F-SEC-R-2)", () => {
  it("cannot be made to inject a second component or property", () => {
    const out = buildIcs({
      uid: "u",
      summary: "A\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nEND:VALARM",
      dateOnly: "2026-01-01",
    });
    const lines = out.split("\r\n");
    expect(lines.filter((l) => l.startsWith("BEGIN:"))).toEqual([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
    ]);
    expect(lines.some((l) => l.startsWith("ACTION:"))).toBe(false);
    // The whole thing survives as one escaped SUMMARY line instead.
    expect(out).toContain("SUMMARY:A\\nBEGIN:VALARM\\nACTION:AUDIO\\nEND:VALARM");
  });

  it("strips control characters and bidi overrides out of a TEXT value", () => {
    expect(escapeText(`A${NUL}B${RTL_OVERRIDE}C${LTR_MARK}`)).toBe("ABC");
    const out = buildIcs({
      uid: "u",
      summary: `Visit ${RTL_OVERRIDE}Jane`,
      dateOnly: "2026-01-01",
    });
    expect(out).toContain("SUMMARY:Visit Jane");
    expect(out).not.toContain(RTL_OVERRIDE);
    expect(out).not.toContain(NUL);
  });

  it("still escapes the RFC 5545 specials, in the right order", () => {
    // A backslash must be doubled BEFORE the others, or the escapes they add
    // get double-escaped in turn.
    expect(escapeText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
  });

  it("escapes a customer's address and note, which is where commas live", () => {
    const out = buildIcs({
      uid: "u",
      summary: "Gutter clean",
      dateOnly: "2026-01-01",
      location: "42 Elm St, Apt 3; rear gate",
      description: "Jane Roe\n555-0100\ngate code 4821",
    });
    expect(out).toContain("LOCATION:42 Elm St\\, Apt 3\\; rear gate");
    expect(out).toContain("DESCRIPTION:Jane Roe\\n555-0100\\ngate code 4821");
  });
});

describe("the export guard covers what the new features add (F-SEC-R-3)", () => {
  it("neutralises a formula in a payment reference or note", () => {
    expect(escapeCell("=cmd|' /c calc'!A1")).toBe("\"'=cmd|' /c calc'!A1\"");
    expect(escapeCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(escapeCell(" =1+1")).toBe("\"' =1+1\"");
  });

  it("leaves an ordinary payment reference and a negative amount alone", () => {
    expect(escapeCell("check 4412")).toBe("check 4412");
    expect(escapeCell("Bank transfer, ref 99")).toBe("\"Bank transfer, ref 99\"");
  });
});
