/**
 * The preset invariants.
 *
 * A preset is data somebody wrote by hand, per trade, and the pipeline it
 * produces has to work: a board with one column is not a pipeline, a board with
 * two won stages cannot report, and a stage whose quiet days are zero nags about
 * everything on the first morning. These are the rules
 * `src/features/onboarding/presets/types.ts` states, checked against all ten.
 */
import { describe, expect, it } from "vitest";
import {
  asTradeId,
  PRESETS,
  presetFor,
  TRADE_IDS,
  TRADE_OPTIONS,
} from "../../../src/features/onboarding/presets";
import type { TradeId } from "../../../src/features/onboarding/presets/types";
import {
  planFromPreset,
  planProblems,
  stageColor,
} from "../../../src/features/onboarding/lib/applyPreset";

const ENTRIES = Object.entries(PRESETS) as [TradeId, (typeof PRESETS)[TradeId]][];

describe("the trade grid", () => {
  it("offers all ten trades, once each, with Something else last", () => {
    expect(TRADE_OPTIONS).toHaveLength(10);
    expect(new Set(TRADE_IDS).size).toBe(10);
    expect(TRADE_OPTIONS[TRADE_OPTIONS.length - 1].id).toBe("other");
  });

  it("has a preset for every trade on the grid, and no orphans", () => {
    for (const option of TRADE_OPTIONS) {
      expect(PRESETS[option.id], `no preset for ${option.id}`).toBeTruthy();
      expect(PRESETS[option.id].id).toBe(option.id);
      expect(PRESETS[option.id].label).toBe(option.label);
    }
    expect(Object.keys(PRESETS).sort()).toEqual([...TRADE_IDS].sort());
  });

  it("falls back to the plain preset for a trade it does not know", () => {
    expect(asTradeId("landscaping")).toBe("landscaping");
    expect(asTradeId("taxidermy")).toBeNull();
    expect(asTradeId(null)).toBeNull();
    expect(presetFor("taxidermy" as TradeId).id).toBe("other");
  });
});

describe.each(ENTRIES)("preset: %s", (_id, preset) => {
  it("has 4 to 8 stages", () => {
    expect(preset.stages.length).toBeGreaterThanOrEqual(4);
    expect(preset.stages.length).toBeLessThanOrEqual(8);
  });

  it("has exactly one won stage and exactly one lost stage", () => {
    expect(preset.stages.filter((s) => s.isWon === true)).toHaveLength(1);
    expect(preset.stages.filter((s) => s.isLost === true)).toHaveLength(1);
    for (const stage of preset.stages) {
      expect(stage.isWon === true && stage.isLost === true).toBe(false);
    }
  });

  it("names every stage once", () => {
    const names = preset.stages.map((s) => s.name.trim().toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const stage of preset.stages) {
      expect(stage.name.trim()).toBe(stage.name);
      expect(stage.name.length).toBeGreaterThan(0);
      expect(stage.name).not.toMatch(/[.!?]$/);
    }
  });

  it("keeps every quiet-day count between 3 and 60", () => {
    for (const stage of preset.stages) {
      expect(Number.isInteger(stage.quietDays)).toBe(true);
      expect(stage.quietDays).toBeGreaterThanOrEqual(3);
      expect(stage.quietDays).toBeLessThanOrEqual(60);
    }
  });

  it("says where the work comes from, starting with the website", () => {
    expect(preset.sources.length).toBeGreaterThanOrEqual(3);
    expect(preset.sources.length).toBeLessThanOrEqual(5);
    const names = preset.sources.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("website");
    for (const source of preset.sources) {
      expect(["website", "referral", "manual", "import"]).toContain(source.kind);
    }
  });

  it("adds two or three fields, and gives every list its options", () => {
    expect(preset.fields.length).toBeGreaterThanOrEqual(2);
    expect(preset.fields.length).toBeLessThanOrEqual(3);
    const identities = preset.fields.map((f) => `${f.entityType}:${f.name.toLowerCase()}`);
    expect(new Set(identities).size).toBe(identities.length);
    for (const field of preset.fields) {
      expect(field.name.trim()).toBe(field.name);
      expect(["contact", "company", "deal"]).toContain(field.entityType);
      if (field.kind === "choice") {
        expect(field.options, `${field.name} is a list with no options`).toBeTruthy();
        expect(field.options!.length).toBeGreaterThanOrEqual(3);
        expect(field.options!.length).toBeLessThanOrEqual(6);
      } else {
        expect(field.options).toBeUndefined();
      }
    }
  });

  it("explains its word for the work in one plain sentence", () => {
    expect(["deals", "jobs", "quotes"]).toContain(preset.vocabulary);
    expect(preset.vocabularyWhy.length).toBeGreaterThan(20);
    expect(preset.vocabularyWhy.length).toBeLessThanOrEqual(95);
    expect(preset.vocabularyWhy).not.toContain("!");
  });

  it("turns into a plan the apply screen will accept", () => {
    const plan = planFromPreset(preset);
    expect(planProblems(plan)).toEqual([]);
    expect(plan.vocabulary).toBe(preset.vocabulary);
    expect(plan.stages.map((s) => s.name)).toEqual(preset.stages.map((s) => s.name));
    expect(new Set(plan.stages.map((s) => s.key)).size).toBe(plan.stages.length);
  });
});

describe("planProblems", () => {
  const base = planFromPreset(PRESETS.landscaping);

  it("refuses a pipeline with no won stage", () => {
    const plan = { ...base, stages: base.stages.map((s) => ({ ...s, isWon: false })) };
    expect(planProblems(plan).map((p) => p.message)).toContain(
      "Mark exactly one stage as the one you have won.",
    );
  });

  it("refuses two stages with the same name", () => {
    const plan = {
      ...base,
      stages: base.stages.map((s, i) => (i === 1 ? { ...s, name: base.stages[0].name } : s)),
    };
    expect(planProblems(plan).some((p) => p.field === "stages")).toBe(true);
  });

  it("refuses a pipeline with one stage, and one with no sources", () => {
    expect(planProblems({ ...base, stages: [base.stages[0]] }).length).toBeGreaterThan(0);
    expect(planProblems({ ...base, sources: [] }).map((p) => p.field)).toContain("sources");
  });

  it("ignores a row the owner blanked out rather than removed", () => {
    const plan = { ...base, sources: [...base.sources, { key: "x", name: "  ", kind: "manual" }] };
    expect(planProblems(plan)).toEqual([]);
  });
});

describe("stageColor", () => {
  it("gives won the green and lost the red, and walks the ramp otherwise", () => {
    expect(stageColor({ isWon: true, isLost: false }, 0)).toBe("var(--stage-5)");
    expect(stageColor({ isWon: false, isLost: true }, 0)).toBe("var(--stage-6)");
    const open = [0, 1, 2, 3].map((i) => stageColor({ isWon: false, isLost: false }, i));
    expect(new Set(open).size).toBe(4);
    expect(open).not.toContain("var(--stage-5)");
    expect(open).not.toContain("var(--stage-6)");
  });
});
