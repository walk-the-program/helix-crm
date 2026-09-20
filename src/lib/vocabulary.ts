/**
 * The vocabulary table: the one place that knows the owner's word for a deal.
 *
 * The database always says `deals` and `stages`. What the owner reads is
 * whichever of Deals, Jobs or Quotes he chose in Settings > Vocabulary. This
 * is labels only — nothing in the schema changes, ever.
 *
 * WHY THIS IS IN src/lib AND NOT src/app
 * --------------------------------------
 * It used to live in src/app/vocabulary.ts next to the React hook that reads
 * it. The rule that src/db never imports src/app is a good rule and it holds,
 * but it had a cost nobody had priced: a repository validating a write could
 * not reach the table, so every message it raised said "deal" to an owner who
 * had spent the setup screen telling Helix he calls them jobs. "A document
 * belongs to a deal." is the kind of sentence that makes a product feel like
 * it was not listening.
 *
 * So the pure part — the table, the type and the lookup — lives here, with no
 * React and no database imports, and anything in the app may read it: a
 * repository can pair `settings.get("vocabulary")` with `vocabularyFor(...)`
 * at validation time and say "job". `useVocabulary()` stays in
 * src/app/vocabulary.ts, because a hook belongs with the query client, and
 * that module re-exports everything below so no existing import changed.
 */

export type VocabularyKey = "deals" | "jobs" | "quotes";

export type Vocabulary = {
  key: VocabularyKey;
  one: string;
  many: string;
  /** "New job", "New quote", "New deal" */
  newOne: string;
  lower: string;
  lowerMany: string;
};

const TABLE: Record<VocabularyKey, Vocabulary> = {
  deals: {
    key: "deals",
    one: "Deal",
    many: "Deals",
    newOne: "New deal",
    lower: "deal",
    lowerMany: "deals",
  },
  jobs: {
    key: "jobs",
    one: "Job",
    many: "Jobs",
    newOne: "New job",
    lower: "job",
    lowerMany: "jobs",
  },
  quotes: {
    key: "quotes",
    one: "Quote",
    many: "Quotes",
    newOne: "New quote",
    lower: "quote",
    lowerMany: "quotes",
  },
};

export const DEFAULT_VOCABULARY: Vocabulary = TABLE.deals;

/** Never throws and never returns undefined: an unknown key reads as Deals. */
export function vocabularyFor(key: VocabularyKey): Vocabulary {
  return TABLE[key] ?? DEFAULT_VOCABULARY;
}
