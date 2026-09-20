import { describe, it, expect } from "vitest";
import { sanitizeDisplayName } from "@/db/repos/attachments";

/**
 * LR-SEC-W1 item 8: the attachment's DISPLAY name (`fileName`) is shown in
 * the file list and in the "Removed <name>" toast, but never touches disk -
 * only `storedName` (a Rust-minted UUID) does. These prove the hostile
 * shapes called out in the packet are neutralised before the row is ever
 * written, without pasting the actual invisible characters into this file
 * (built instead from their code points, exactly like the function itself).
 */

const NUL = String.fromCodePoint(0x0000);
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const LRO = String.fromCodePoint(0x202a); // left-to-right override
const LRM = String.fromCodePoint(0x200e); // left-to-right mark

describe("sanitizeDisplayName", () => {
  it("leaves an ordinary name unchanged", () => {
    expect(sanitizeDisplayName("quote.pdf")).toBe("quote.pdf");
  });

  it("strips a NUL byte", () => {
    expect(sanitizeDisplayName(`evil${NUL}.pdf`)).toBe("evil.pdf");
  });

  it("strips a right-to-left override so it cannot disguise an extension", () => {
    // Rendered in an RTL-aware view, "evil" + RLO + "exe.gpj" reads as
    // "evilgpj.exe" - the raw code points are what land in the database and
    // the UI, so stripping the control character is what actually matters.
    const disguised = `evil${RLO}exe.gpj`;
    const cleaned = sanitizeDisplayName(disguised);
    expect(cleaned).not.toContain(RLO);
    expect(cleaned).toBe("evilexe.gpj");
  });

  it("strips a left-to-right override and a left-to-right mark too", () => {
    expect(sanitizeDisplayName(`${LRO}name${LRM}.txt`)).toBe("name.txt");
  });

  it("replaces a path separator so the display string can never look like a path", () => {
    expect(sanitizeDisplayName("a/b\\c.txt")).toBe("a_b_c.txt");
  });

  it("caps an absurdly long name at 255 code points", () => {
    const long = "a".repeat(500) + ".txt";
    const result = sanitizeDisplayName(long);
    expect(Array.from(result).length).toBe(255);
  });

  it("does not split a 4-byte emoji when capping the length", () => {
    const long = "🙂".repeat(300);
    const result = sanitizeDisplayName(long);
    expect(Array.from(result).length).toBe(255);
    expect(Array.from(result).every((ch) => ch === "🙂")).toBe(true);
  });

  it("falls back to a placeholder when nothing is left after stripping", () => {
    expect(sanitizeDisplayName(`${NUL}${RLO}`)).toBe("file");
  });

  it("falls back to a placeholder for a blank or whitespace-only name", () => {
    expect(sanitizeDisplayName("   ")).toBe("file");
  });

  it("leaves a Windows-reserved device name alone - it is never used as a real path", () => {
    expect(sanitizeDisplayName("CON")).toBe("CON");
    expect(sanitizeDisplayName("PRN.txt")).toBe("PRN.txt");
  });

  it("trims ordinary leading and trailing whitespace", () => {
    expect(sanitizeDisplayName("  spaced.txt  ")).toBe("spaced.txt");
  });
});
