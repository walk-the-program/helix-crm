/**
 * Vocabulary: the database always says `deals` and `stages`; the labels on
 * screen come from settings.vocabulary, which the owner sets to Deals, Jobs or
 * Quotes. This is labels only - nothing in the schema changes.
 */
import { useQuery } from "@tanstack/react-query";
import * as settings from "@/db/repos/settings";
import { qk } from "@/app/queryClient";

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

export function vocabularyFor(key: VocabularyKey): Vocabulary {
  return TABLE[key] ?? DEFAULT_VOCABULARY;
}

/** Read the workspace's vocabulary. Falls back to Deals while loading. */
export function useVocabulary(): Vocabulary {
  const { data } = useQuery({
    queryKey: qk.setting(settings.VOCABULARY_KEY),
    queryFn: () => settings.get("vocabulary"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return vocabularyFor(data ?? "deals");
}

/** Non-hook read, for services and commands. */
export async function readVocabulary(): Promise<Vocabulary> {
  return vocabularyFor(await settings.get("vocabulary"));
}
