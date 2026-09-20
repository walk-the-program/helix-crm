/**
 * Vocabulary, the React side: the hook and the non-hook read.
 *
 * The table itself moved to src/lib/vocabulary.ts, which is pure — no React,
 * no database — so a repository can use it too. src/db never imports src/app,
 * and that rule meant a validation message could only ever say "deal" to an
 * owner who calls them jobs. Everything the table exports is re-exported here,
 * so every existing `from "@/app/vocabulary"` import keeps working unchanged.
 *
 * This is labels only. The database always says `deals` and `stages`; nothing
 * in the schema changes.
 */
import { useQuery } from "@tanstack/react-query";
import * as settings from "@/db/repos/settings";
import { qk } from "@/app/queryClient";
import { vocabularyFor, type Vocabulary } from "@/lib/vocabulary";

export type { Vocabulary, VocabularyKey } from "@/lib/vocabulary";
export { DEFAULT_VOCABULARY, vocabularyFor } from "@/lib/vocabulary";

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
