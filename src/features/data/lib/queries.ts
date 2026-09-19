/**
 * Query keys for the data feature, in one place so every screen invalidates
 * the same strings. Shared keys from src/app/queryClient.ts (`qk`) are reused
 * whenever the data that changed belongs to another feature: an import
 * invalidates `qk.contacts()` and `qk.companies()`, a merge invalidates both
 * plus `qk.merges()`.
 */
export const dqk = {
  /** The remembered column mapping for one header signature. */
  mapping: (signature: string) => ["data", "mapping", signature] as const,
  backups: () => ["data", "backups"] as const,
  duplicatePairs: (entityType: string) =>
    ["data", "duplicates", entityType] as const,
  mergeHistory: () => ["data", "merges"] as const,
  attachments: (entityType: string, entityId: string) =>
    ["data", "attachments", entityType, entityId] as const,
  exportCounts: () => ["data", "exportCounts"] as const,
} as const;
