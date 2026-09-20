/**
 * What a trade preset is.
 *
 * A preset is the answer to "how does this trade talk about its work", in
 * words the owner already uses: what he calls the thing he sells, the stages he
 * moves it through, where the work comes from, and the two or three details he
 * writes on every job that no CRM has a column for.
 *
 * A preset holds words and numbers only. Stage colours, positions and the
 * won/lost flags' database shape are decided in `applyPreset.ts`, because those
 * are about the pipeline and not about the trade.
 *
 * Invariants, enforced by `tests/unit/onboarding/presets.test.ts`:
 *  - 4 to 8 stages;
 *  - exactly one won stage and exactly one lost stage;
 *  - stage names unique within a preset;
 *  - every `quietDays` between 3 and 60;
 *  - every service name unique within a preset, non-empty and trimmed;
 *  - every `unitPriceCents` a positive integer;
 *  - a recurring service has an interval, a one-time service has none.
 */

export type TradeId =
  | "landscaping"
  | "home-services"
  | "dental"
  | "medical-spa"
  | "wedding-venue"
  | "church"
  | "restaurant"
  | "pilates-studio"
  | "crossfit-gym"
  | "other";

/** The word the product uses for the thing being tracked (settings.vocabulary). */
export type VocabularyKey = "deals" | "jobs" | "quotes";

export type PresetStage = {
  /** The trade's own word for this step. Sentence case. */
  name: string;
  /**
   * How many days a row may sit in this stage before Today calls it quiet.
   * 3 to 60: under three days every stage nags, over sixty nothing ever does.
   */
  quietDays: number;
  isWon?: boolean;
  isLost?: boolean;
};

export type PresetSource = {
  name: string;
  /** Matches the seed's source kinds: website, referral, import, manual, ... */
  kind: string;
};

export type PresetFieldKind = "text" | "number" | "date" | "choice";

export type PresetField = {
  name: string;
  kind: PresetFieldKind;
  /** Which record the field hangs off. Most are on the work itself. */
  entityType: "contact" | "company" | "deal";
  /** `choice` only: the options, in the order they should appear. */
  options?: string[];
};

/**
 * The price list a brand new workspace starts with, if it picked this trade.
 * A new workspace only; nothing is ever seeded into a workspace that already
 * exists. `intervalMonths`-style cleverness is deliberately absent: a service
 * is one-time, per month or per year, because that is what an owner says.
 */
export type PresetService = {
  name: string;
  kind: "one_time" | "recurring";
  /** "month" | "year" for a recurring service, null for a one-time one. */
  interval: "month" | "year" | null;
  unitPriceCents: number;
  taxable?: boolean;
};

export type TradePreset = {
  id: TradeId;
  /** What the trade is called on the grid in screen 1. */
  label: string;
  vocabulary: VocabularyKey;
  /**
   * One line, shown next to the word on screen 2, saying why that word and not
   * one of the other two. It is the sentence the owner reads to decide whether
   * to change it, so it names the trade's own reality rather than the product's.
   */
  vocabularyWhy: string;
  stages: PresetStage[];
  sources: PresetSource[];
  fields: PresetField[];
  services: PresetService[];
};
