/**
 * The TanStack Query client.
 *
 * Everything here is local SQLite, so a refetch costs milliseconds and the
 * cached rows stay on screen while it runs. That is why nothing is treated as
 * fresh for long: every screen that mounts asks again (staleTime 0), the app
 * asks again when it regains focus, and `src/app/refresh.ts` invalidates on
 * every route change and on the owner's own Refresh. The cache is cleared
 * after every db_open (launch, restore, workspace switch), because the rows
 * behind it belong to a different file from that moment on.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/** Called after every database open. */
export function resetQueryCache(): void {
  queryClient.clear();
}

/** Query keys, in one place so features invalidate the same strings. */
export const qk = {
  contacts: (filter?: unknown) => ["contacts", filter ?? null] as const,
  contact: (id: string) => ["contact", id] as const,
  companies: (filter?: unknown) => ["companies", filter ?? null] as const,
  company: (id: string) => ["company", id] as const,
  deals: (filter?: unknown) => ["deals", filter ?? null] as const,
  deal: (id: string) => ["deal", id] as const,
  board: (pipelineId: string) => ["board", pipelineId] as const,
  stages: (pipelineId?: string) => ["stages", pipelineId ?? null] as const,
  pipelines: () => ["pipelines"] as const,
  activities: (filter?: unknown) => ["activities", filter ?? null] as const,
  tasks: (filter?: unknown) => ["tasks", filter ?? null] as const,
  today: () => ["today"] as const,
  /** The Schedule's derived feed, one query per visible range. */
  schedule: (from?: string, to?: string) =>
    ["schedule", from ?? null, to ?? null] as const,
  tags: () => ["tags"] as const,
  sources: () => ["sources"] as const,
  savedViews: (entityType?: string) =>
    ["savedViews", entityType ?? null] as const,
  customFields: (entityType?: string) =>
    ["customFields", entityType ?? null] as const,
  settings: () => ["settings"] as const,
  setting: (key: string) => ["setting", key] as const,
  search: (query: string) => ["search", query] as const,
  trash: (entityType?: string) => ["trash", entityType ?? null] as const,
  merges: () => ["merges"] as const,
  leadSync: (origin: string) => ["leadSync", origin] as const,
  diagnostics: () => ["diagnostics"] as const,
} as const;
