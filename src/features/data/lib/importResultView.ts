/**
 * What the result screen shows, worked out away from the markup.
 *
 * Two importers land here - the contacts one (`importRun.ts`) and the generic
 * one (`typedImportRun.ts`) - and they count different things. Rather than
 * teach `ResultStep` about both shapes, each one is turned into the same small
 * view: a row of counts with the nouns already in them, one sentence of
 * detail, the rows that did not go in, and the warnings.
 *
 * The contacts view is deliberately byte-for-byte what the screen said before
 * this file existed, labels and order included; its e2e assertions still read
 * "52 contacts created".
 */
import type { ImportResult, SkippedRow } from "@/features/data/lib/importRun";
import type { ImportWarning, TypedImportResult } from "@/features/data/lib/typedImportRun";
import type { ImportTypeId } from "@/features/data/import/fields/types";

export type ResultView = {
  typeId: ImportTypeId;
  counts: { value: number; label: string }[];
  totalRows: number;
  durationMs: number;
  /** ", 3 new tags" and the like, appended to the one-line summary. */
  extras: string[];
  headers: string[];
  skipped: number;
  skippedRows: SkippedRow[];
  skippedTruncated: boolean;
  warnings: ImportWarning[];
  warningsTruncated: boolean;
  /**
   * The backup Helix took immediately before this import, or null on a run
   * that did not take one. The result screen names it, because "restore the
   * backup" is what undoing an import means and an owner who has just imported
   * the wrong file needs to know the way back exists before he goes looking
   * for it (LR-OPS, F-OPS-4).
   */
  preImportBackupPath: string | null;
  /**
   * The black button at the bottom: where the owner goes to see the result,
   * and which glyph goes on it. `icon` is a name from src/ui/icons.ts rather
   * than an element, so this file stays free of JSX.
   */
  destination: { href: string; label: string; icon: "people" | "board" | "buildings" | "tag" };
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function contactsResultView(result: ImportResult): ResultView {
  const extras: string[] = [];
  if (result.tagsCreated > 0) {
    extras.push(`${result.tagsCreated} new ${plural(result.tagsCreated, "tag", "tags")}`);
  }
  if (result.customFieldsCreated > 0) {
    extras.push(
      `${result.customFieldsCreated} new custom ${plural(
        result.customFieldsCreated,
        "field",
        "fields",
      )}`,
    );
  }

  return {
    typeId: "contacts",
    counts: [
      { value: result.created, label: "contacts created" },
      { value: result.updated, label: "contacts updated" },
      { value: result.skipped, label: "rows skipped" },
      { value: result.companiesCreated, label: "companies created" },
    ],
    totalRows: result.totalRows,
    durationMs: result.durationMs,
    extras,
    headers: result.headers,
    skipped: result.skipped,
    skippedRows: result.skippedRows,
    skippedTruncated: result.skippedTruncated,
    warnings: [],
    warningsTruncated: false,
    preImportBackupPath: result.preImportBackupPath,
    destination: { href: "/contacts", label: "See the contacts", icon: "people" },
  };
}

export function typedResultView(result: TypedImportResult): ResultView {
  const extras: string[] = [];
  if (result.tagsCreated > 0) {
    extras.push(`${result.tagsCreated} new ${plural(result.tagsCreated, "tag", "tags")}`);
  }
  if (result.sourcesCreated > 0) {
    extras.push(
      `${result.sourcesCreated} new ${plural(result.sourcesCreated, "source", "sources")}`,
    );
  }

  const counts =
    result.typeId === "deals"
      ? [
          { value: result.created, label: "deals created" },
          { value: result.skipped, label: "rows skipped" },
          { value: result.contactsCreated, label: "contacts created" },
          { value: result.companiesCreated, label: "companies created" },
        ]
      : result.typeId === "services"
        ? [
            { value: result.created, label: "services created" },
            { value: result.updated, label: "services updated" },
            { value: result.skipped, label: "rows skipped" },
          ]
        : [
            { value: result.created, label: "companies created" },
            { value: result.updated, label: "companies updated" },
            { value: result.skipped, label: "rows skipped" },
          ];

  return {
    typeId: result.typeId,
    counts,
    totalRows: result.totalRows,
    durationMs: result.durationMs,
    extras,
    headers: result.headers,
    skipped: result.skipped,
    skippedRows: result.skippedRows,
    skippedTruncated: result.skippedTruncated,
    warnings: result.warnings,
    warningsTruncated: result.warningsTruncated,
    preImportBackupPath: result.preImportBackupPath,
    destination:
      result.typeId === "deals"
        ? { href: "/pipeline", label: "See the pipeline", icon: "board" as const }
        : result.typeId === "services"
          ? { href: "/settings/services", label: "See your services", icon: "tag" as const }
          : { href: "/companies", label: "See the companies", icon: "buildings" as const },
  };
}
