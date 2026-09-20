/**
 * LR-SEC-W2, item 3: hostile-input coverage for the CSV formula-injection
 * guard in src/features/data/lib/exportCsv.ts.
 *
 * The pre-existing tests/unit/data/exportCsv.test.ts is left untouched. This
 * file adds the cases the security packet called out by name: a leading LF
 * (not in the original trigger character class) and a leading space/Unicode
 * space ahead of a trigger character (a spreadsheet trims leading whitespace
 * before deciding a cell is a formula, so RFC 4180 quoting alone does not
 * neutralise it).
 */
import { describe, expect, it } from "vitest";
import { escapeCell, guardCell, toCsv } from "../../../src/features/data/lib/exportCsv";

describe("guardCell: hostile leading-whitespace and LF cases", () => {
  it("guards a leading LF, matching the already-guarded CR", () => {
    expect(guardCell("\n=1+1")).toBe("'\n=1+1");
  });

  it("guards a leading plain space ahead of a trigger character", () => {
    expect(guardCell(" =1")).toBe("' =1");
    expect(guardCell(" +1")).toBe("' +1");
    expect(guardCell(" -1")).toBe("' -1");
    expect(guardCell(" @SUM(1)")).toBe("' @SUM(1)");
  });

  it("guards a leading run of several spaces ahead of a trigger character", () => {
    expect(guardCell("   =1+1")).toBe("'   =1+1");
  });

  it("guards a leading Unicode space (NBSP) ahead of a trigger character", () => {
    expect(guardCell(" =1+1")).toBe("' =1+1");
  });

  it("guards a leading Unicode line/paragraph separator ahead of a trigger character", () => {
    expect(guardCell(" =1+1")).toBe("' =1+1");
  });

  it("still does not guard plain leading whitespace with no trigger behind it", () => {
    expect(guardCell("   hello")).toBe("   hello");
    expect(guardCell(" hello")).toBe(" hello");
  });

  it("a value of only plain spaces (no trigger character behind them) is left alone", () => {
    expect(guardCell("   ")).toBe("   ");
  });

  it("a bare leading tab is still guarded directly, as before (tab is a direct trigger on its own)", () => {
    expect(guardCell("\t")).toBe("'\t");
  });
});

describe("escapeCell: the guard survives RFC 4180 quoting for the hostile cases", () => {
  it("a leading-space formula round-trips as a quoted, apostrophe-guarded cell", () => {
    expect(escapeCell(" =1+1")).toBe(`"' =1+1"`);
  });

  it("a leading-LF formula round-trips as a quoted, apostrophe-guarded cell", () => {
    expect(escapeCell("\n=1+1")).toBe(`"'\n=1+1"`);
  });
});

describe("toCsv: a whole row carrying the hostile values", () => {
  it("guards every hostile cell in a row without disturbing the plain ones", () => {
    const csv = toCsv(
      ["Name", "Note"],
      [["Ada", " =1+1"], ["Grace", "\n=cmd|'/bin/calc'"]],
    );
    expect(csv).toBe(
      'Name,Note\r\n' +
        'Ada,"\' =1+1"\r\n' +
        `Grace,"'\n=cmd|'/bin/calc'"\r\n`,
    );
  });
});
