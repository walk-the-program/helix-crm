/**
 * Step 1: choose the file.
 *
 * A drop zone that takes a real drag-drop from the desktop (Tauri hands over
 * paths), a browser File (the e2e build), and falls back to the file dialog
 * whenever the dropped path is not something Helix may read.
 *
 * It is a panel with a dashed hairline, not a bordered web upload widget: no
 * 40px spot glyph in the middle (docs/DESIGN.md §11), no second border weight,
 * and the drag state is a tint rather than a colour.
 *
 * The step above this one (TypePicker) already asks and answers the real
 * question - what kind of file is this - with a sentence under each choice,
 * so this step explains nothing on its own: one line under the box names the
 * formats it reads and points at the example file, and that is the only
 * sentence on the step (phase-two design direction, rule 3).
 */
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FolderOpen } from "@/ui/icons";
import { Button } from "@/ui";
import {
  loadCsvFromFile,
  loadDroppedPath,
  pickCsvFile,
  subscribeFileDrop,
  type LoadedCsv,
} from "@/features/data/lib/filePick";

export function FilePickStep(props: {
  /** "Contacts", "Companies", "Deals": what the owner picked one step above. */
  typeLabel: string;
  onLoaded: (file: LoadedCsv) => void;
  onError: (error: unknown) => void;
}) {
  const { typeLabel, onLoaded, onError } = props;
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The desktop drag-drop event, which carries a real path.
  useEffect(() => {
    return subscribeFileDrop((paths) => {
      void run(async () => loadDroppedPath(paths[0]));
    });
  }, []);

  async function run(load: () => Promise<LoadedCsv | null>) {
    setBusy(true);
    try {
      const file = await load();
      if (file) onLoaded(file);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      setDragging(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void run(async () => loadCsvFromFile(file));
      return;
    }
    // Nothing readable came with the drop: ask the dialog instead.
    void run(pickCsvFile);
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="import-dropzone"
        className={[
          "flex flex-col items-center justify-center gap-[var(--space-4)]",
          "border border-dashed",
          "px-[var(--space-6)] py-[var(--space-7)] text-center",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
          dragging
            ? "border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        ].join(" ")}
      >
        <p className="font-[family-name:var(--font-heading)] text-[length:var(--text-subhead)] font-bold leading-[var(--leading-subhead)] tracking-[var(--tracking-title)] text-[var(--color-heading)]">
          Drop a spreadsheet here
        </p>
        <Button
          ref={buttonRef}
          variant="primary"
          loading={busy}
          loadingLabel="Opening…"
          iconLeft={<FolderOpen size={16} weight="bold" aria-hidden="true" />}
          onClick={() => void run(pickCsvFile)}
        >
          Choose a file
        </Button>
      </div>

      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Works with a CSV from HubSpot, Zoho, Pipedrive, Google Contacts, or
        Excel, read in as {typeLabel.toLowerCase()}. Not sure of the columns?
        Download an example from the top right.
      </p>
    </div>
  );
}
