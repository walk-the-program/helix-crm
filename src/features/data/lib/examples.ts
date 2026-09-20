/**
 * The "Download an example" files for the import wizard.
 *
 * An owner staring at a blank import screen does not want a spec, they want a
 * file they can open in a spreadsheet, fill in over their own data, and drag
 * back in. So every example:
 *
 *   - has a header row Helix's own guesser reads back with nothing left on
 *     Skip (tests/unit/data/importExamples.test.ts holds that promise), and
 *   - fills its "Stage" column with this workspace's actual stage names, not
 *     a stranger's, so the file downloads directly importable.
 *
 *   IMPORT_TYPES ---> buildExampleCsv (per type, pure) ---> ExampleFile
 *                                ^
 *                                |
 *                       exampleContext()  (reads the live stages)
 *
 *   ExampleFile --saveExampleFile--> one CSV, through the save dialog
 *   ExampleFile[] --saveAllExamplesZip--> one zip, same plumbing as export
 *
 * Building a file is pure - no database, no filesystem - so the unit test can
 * check every type's round trip without a webview. Only `exampleContext` and
 * the two `save*` functions touch the outside world.
 */
import * as pipelines from "@/db/repos/pipelines";
import * as stagesRepo from "@/db/repos/stages";
import { IMPORT_TYPES } from "@/features/data/import/fields/index";
import type {
  ExampleContext,
  ImportTypeDefinition,
  ImportTypeId,
} from "@/features/data/import/fields/types";
import { toCsv } from "@/features/data/lib/exportCsv";
import { pickSavePath, writeBytesAt, writeTextFileAt } from "@/features/data/lib/fsBridge";

export type ExampleFile = { typeId: ImportTypeId; fileName: string; csv: string };

/** Every example downloads with three rows of made-up data. */
const EXAMPLE_ROWS = 3;

/**
 * Used only when the workspace has no stages at all - which should not
 * happen past first boot, but a downloadable file must never come back with
 * an empty Stage column.
 */
const FALLBACK_STAGE_NAMES: readonly string[] = ["New", "Quoted", "Won"];

/* -------------------------------------------------------------------------- */
/* the live context                                                          */
/* -------------------------------------------------------------------------- */

/** The live workspace facts an example needs: today's stage names, in board order. */
export async function exampleContext(): Promise<ExampleContext> {
  const pipeline = await pipelines.getDefault();
  const stages = pipeline ? await stagesRepo.list(pipeline.id) : [];
  const names = stages.map((s) => s.name.trim()).filter((name) => name.length > 0);
  return { stageNames: names.length > 0 ? names : FALLBACK_STAGE_NAMES };
}

/* -------------------------------------------------------------------------- */
/* building (pure)                                                           */
/* -------------------------------------------------------------------------- */

/** Header row = every field's label, in field order; then three rows. */
export function buildExampleCsv(type: ImportTypeDefinition, context: ExampleContext): string {
  const headers = type.fields.map((field) => field.label);
  const rows: string[][] = [];
  for (let n = 0; n < EXAMPLE_ROWS; n += 1) {
    rows.push(
      type.fields.map((field) => {
        const cells = field.liveExamples ? field.liveExamples(context) : field.examples;
        return cells[n];
      }),
    );
  }
  return toCsv(headers, rows);
}

export function buildExampleFile(type: ImportTypeDefinition, context: ExampleContext): ExampleFile {
  return {
    typeId: type.id,
    fileName: type.exampleFileName,
    csv: buildExampleCsv(type, context),
  };
}

/** One file per entry in IMPORT_TYPES, in the same order as the radio list. */
export function buildAllExampleFiles(context: ExampleContext): ExampleFile[] {
  return IMPORT_TYPES.map((type) => buildExampleFile(type, context));
}

/* -------------------------------------------------------------------------- */
/* saving (dialog + write, through fsBridge - same door the export uses)      */
/* -------------------------------------------------------------------------- */

/** Save one example through the dialog + fs plugins. null when the owner cancelled. */
export async function saveExampleFile(file: ExampleFile): Promise<string | null> {
  const path = await pickSavePath({
    title: "Save the example",
    defaultPath: file.fileName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (path === null) return null;
  await writeTextFileAt(path, file.csv);
  return path;
}

/** All of them in one zip, same plumbing as the existing export zip. */
export async function saveAllExamplesZip(files: ExampleFile[]): Promise<string | null> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.fileName, file.csv);
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });

  const path = await pickSavePath({
    title: "Save the examples",
    defaultPath: "helix-import-examples.zip",
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (path === null) return null;
  await writeBytesAt(path, bytes);
  return path;
}
