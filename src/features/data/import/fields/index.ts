/**
 * The register of things the owner can import.
 *
 * Order is the order of the radio list on the first step, and Contacts is
 * first because it is what most owners bring first.
 *
 * Services is last because it is the one an owner reaches for after the other
 * three: the catalog of what you sell, which quotes and invoices are built
 * from. It writes into `products`, which arrived with the revenue migration
 * (drizzle/0004_revenue.sql).
 */
import { CONTACTS_IMPORT } from "@/features/data/import/fields/contacts";
import { COMPANIES_IMPORT } from "@/features/data/import/fields/companies";
import { DEALS_IMPORT } from "@/features/data/import/fields/deals";
import { SERVICES_IMPORT } from "@/features/data/import/fields/services";
import type {
  ImportTypeDefinition,
  ImportTypeId,
} from "@/features/data/import/fields/types";

export const IMPORT_TYPES: readonly ImportTypeDefinition[] = [
  CONTACTS_IMPORT,
  COMPANIES_IMPORT,
  DEALS_IMPORT,
  SERVICES_IMPORT,
] as const;

export const DEFAULT_IMPORT_TYPE: ImportTypeId = "contacts";

export function importType(id: ImportTypeId): ImportTypeDefinition {
  const found = IMPORT_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`No import type "${id}".`);
  return found;
}

export { CONTACTS_IMPORT, COMPANIES_IMPORT, DEALS_IMPORT, SERVICES_IMPORT };
export * from "@/features/data/import/fields/types";
