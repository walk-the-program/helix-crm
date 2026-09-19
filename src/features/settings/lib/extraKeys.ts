/**
 * Settings keys this feature needs that `src/db/repos/settings.ts` does not
 * define yet.
 *
 * The repository's registry is the source of truth for every known key, and a
 * feature agent may not edit it (docs/CONTRACTS.md). So a key that is missing
 * is declared here with its own zod schema and read and written through the
 * repository's unvalidated `getRaw` / `setRaw` escape hatch, with validation
 * done here instead. Every key declared this way is listed in docs/STATUS.md
 * under "Contract changes needed" so the orchestrator can promote it into the
 * registry, after which this file shrinks.
 *
 * `get` never throws: a corrupted row falls back to the default, exactly as the
 * repository's own `get` does.
 */
import type { z } from "zod";
import * as settings from "@/db/repos/settings";

export type ExtraSetting<T> = {
  key: string;
  defaultValue: T;
  get(): Promise<T>;
  set(value: T): Promise<void>;
};

export function defineExtraSetting<S extends z.ZodType>(
  key: string,
  schema: S,
  defaultValue: z.infer<S>,
): ExtraSetting<z.infer<S>> {
  return {
    key,
    defaultValue,
    async get() {
      const stored = await settings.getRaw(key);
      if (stored === undefined) return defaultValue;
      const parsed = schema.safeParse(stored);
      return parsed.success ? (parsed.data as z.infer<S>) : defaultValue;
    },
    async set(value) {
      const parsed = schema.parse(value) as unknown;
      await settings.setRaw(key, parsed);
    },
  };
}
