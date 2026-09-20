/**
 * "Download an example", top right of the Import screen.
 *
 * The question an owner asks before they ever open a spreadsheet is "what do
 * you want the columns to be?". This answers it with a file rather than a
 * paragraph: one example per thing you can import, each generated at click
 * time from the same field definitions the mapper reads, so it can never drift
 * out of date. The deals example is filled with this workspace's real stage
 * names, which makes it a file the owner can edit and import straight back.
 *
 * It is a secondary button and a plain menu. The one confident block on this
 * screen belongs to the step the owner is on (docs/DESIGN.md section 2), never
 * to a convenience in the header.
 */
import { useState } from "react";
import { CaretDown, Download } from "@/ui/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@/ui";
import { IMPORT_TYPES } from "@/features/data/import/fields/index";
import {
  buildAllExampleFiles,
  buildExampleFile,
  exampleContext,
  saveAllExamplesZip,
  saveExampleFile,
} from "@/features/data/lib/examples";
import type { ImportTypeDefinition } from "@/features/data/import/fields/types";

export function ExamplesMenu() {
  const [busy, setBusy] = useState(false);

  async function saveOne(type: ImportTypeDefinition) {
    setBusy(true);
    try {
      const context = await exampleContext();
      const file = buildExampleFile(type, context);
      const path = await saveExampleFile(file);
      if (path === null) return;
      toast.success(`Saved ${file.fileName}. Fill it in and bring it back.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the example.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    setBusy(true);
    try {
      const context = await exampleContext();
      const files = buildAllExampleFiles(context);
      const path = await saveAllExamplesZip(files);
      if (path === null) return;
      toast.success(`Saved ${files.length} examples.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the examples.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          loading={busy}
          loadingLabel="Saving…"
          iconLeft={<Download size={16} weight="bold" aria-hidden="true" />}
          iconRight={<CaretDown size={14} weight="bold" aria-hidden="true" />}
        >
          Download an example
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {IMPORT_TYPES.map((type) => (
          <DropdownMenuItem key={type.id} onSelect={() => void saveOne(type)}>
            {type.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void saveAll()}>
          All examples (zip)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
