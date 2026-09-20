/**
 * Remembering a mapping per header signature.
 *
 * Every export from the same CRM has the same header row, so the second import
 * should not ask the same questions. The mapping is stored in the workspace's
 * `settings` table under `import.mapping.<signature>` and matched back by
 * header text, not by column position.
 */
import { getRaw, setRaw } from "@/db/repos/settings";
import {
  applyRemembered,
  guessMapping,
  headerSignature,
  toRemembered,
  type ColumnMapping,
  type FieldId,
} from "@/features/data/lib/mapping";
import {
  applyRememberedTyped,
  guessMappingFor,
  toRememberedTyped,
  typedSignature,
  type TypedColumnMapping,
} from "@/features/data/lib/typedMapping";
import type { ImportTypeDefinition } from "@/features/data/import/fields/types";

type Remembered = { header: string; field: FieldId; customName?: string; label?: string };

function keyFor(signature: string): string {
  return `import.mapping.${signature}`;
}

function isRemembered(value: unknown): value is Remembered[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Remembered).header === "string" &&
        typeof (item as Remembered).field === "string",
    )
  );
}

/**
 * The mapping to start from: what the owner chose last time for this shape of
 * file, or the guess. `remembered` tells the screen which of the two it is.
 */
export async function initialMapping(
  headers: string[],
): Promise<{ mapping: ColumnMapping[]; remembered: boolean; signature: string }> {
  const signature = headerSignature(headers);
  let stored: unknown;
  try {
    stored = await getRaw(keyFor(signature));
  } catch {
    stored = undefined;
  }
  if (isRemembered(stored)) {
    return { mapping: applyRemembered(headers, stored), remembered: true, signature };
  }
  return { mapping: guessMapping(headers), remembered: false, signature };
}

export async function rememberMapping(
  signature: string,
  mapping: ColumnMapping[],
): Promise<void> {
  await setRaw(keyFor(signature), toRemembered(mapping));
}

export async function forgetMapping(signature: string): Promise<void> {
  await setRaw(keyFor(signature), null);
}

/* -------------------------------------------------------------------------- */
/* the same thing for companies and deals                                     */
/* -------------------------------------------------------------------------- */

/**
 * The typed signature already carries the type id (`deals.14-1abc`), so the
 * setting key is keyed per type and header shape without any extra work: the
 * same file mapped once as Companies and once as Deals remembers both.
 *
 * Contacts keeps the original un-prefixed key above. Owners who have already
 * mapped their CRM's export should not be asked again because the code around
 * them grew a second import type.
 */
type RememberedTyped = { header: string; field: string };

function isRememberedTyped(value: unknown): value is RememberedTyped[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RememberedTyped).header === "string" &&
        typeof (item as RememberedTyped).field === "string",
    )
  );
}

export async function initialTypedMapping(
  type: ImportTypeDefinition,
  headers: string[],
): Promise<{ mapping: TypedColumnMapping[]; remembered: boolean; signature: string }> {
  const signature = typedSignature(type.id, headers);
  let stored: unknown;
  try {
    stored = await getRaw(keyFor(signature));
  } catch {
    stored = undefined;
  }
  if (isRememberedTyped(stored)) {
    return {
      mapping: applyRememberedTyped(headers, stored),
      remembered: true,
      signature,
    };
  }
  return { mapping: guessMappingFor(type, headers), remembered: false, signature };
}

export async function rememberTypedMapping(
  signature: string,
  mapping: TypedColumnMapping[],
): Promise<void> {
  await setRaw(keyFor(signature), toRememberedTyped(mapping));
}
