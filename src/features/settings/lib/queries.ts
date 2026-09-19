/**
 * Query keys and small read hooks shared by every settings screen.
 *
 * Keys come from `src/app/queryClient.ts` wherever one exists (so a write in
 * another feature invalidates the same string); the two that do not exist there
 * - the workspace registry and the AI key state - are namespaced under
 * "settings" here and listed for promotion.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { qk, queryClient } from "@/app/queryClient";
import * as settingsRepo from "@/db/repos/settings";
import * as tagsRepo from "@/db/repos/tags";
import * as customFieldsRepo from "@/db/repos/customFields";
import { readRegistry, type HelixRegistry } from "@/app/appSettings";

/** Keys this feature owns, on top of the shared ones in qk. */
export const settingsKeys = {
  all: () => qk.settings(),
  registry: () => ["settings", "registry"] as const,
  diagnostics: () => qk.diagnostics(),
  tagCounts: () => ["settings", "tagCounts"] as const,
  fieldValueCounts: (fieldId: string) =>
    ["settings", "fieldValueCounts", fieldId] as const,
  aiState: () => ["settings", "ai"] as const,
} as const;

/** Every known workspace setting, resolved with its default. */
export function useWorkspaceSettings() {
  return useQuery({
    queryKey: settingsKeys.all(),
    queryFn: () => settingsRepo.getAll(),
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk.tags(),
    queryFn: () => tagsRepo.list(),
  });
}

export function useTagCounts() {
  return useQuery({
    queryKey: settingsKeys.tagCounts(),
    queryFn: () => tagsRepo.counts(),
  });
}

export function useCustomFields(entityType: string) {
  return useQuery({
    queryKey: qk.customFields(entityType),
    queryFn: () => customFieldsRepo.list(entityType),
  });
}

export function useRegistry() {
  return useQuery({
    queryKey: settingsKeys.registry(),
    queryFn: (): Promise<HelixRegistry> => readRegistry(),
    staleTime: 0,
  });
}

/**
 * Re-read helix.json into the cache.
 *
 * Not `invalidateQueries`: every `db_open` - and therefore every workspace
 * switch - calls `resetQueryCache()` (`queryClient.clear()`), which removes the
 * registry query from the cache entirely. Invalidating a key that is no longer
 * there marks nothing stale and wakes nobody, so the mounted list went on
 * showing the workspace the owner had just left as the open one. `fetchQuery`
 * puts the entry back with fresh data, which the mounted observer picks up.
 */
export async function refetchRegistry(client: QueryClient = queryClient): Promise<void> {
  await client.fetchQuery({
    queryKey: settingsKeys.registry(),
    queryFn: () => readRegistry(),
    staleTime: 0,
  });
}

/** After any settings write: the screen, the sidebar labels and money all read it. */
export async function invalidateSettings(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: settingsKeys.all() });
  await queryClient.invalidateQueries({ queryKey: ["setting"] });
}

export function useInvalidator() {
  const client = useQueryClient();
  return async (keys: readonly unknown[][]) => {
    for (const key of keys) {
      await client.invalidateQueries({ queryKey: key });
    }
  };
}
