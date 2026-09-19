/**
 * Step 1: choose the file.
 *
 * A drop zone that takes a real drag-drop from the desktop (Tauri hands over
 * paths), a browser File (the e2e build), and falls back to the file dialog
 * whenever the dropped path is not something Helix may read.
 */
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FileSpreadsheet, FolderOpen } from "lucide-react";
import { Button } from "@/ui";
import {
  loadCsvFromFile,
  loadDroppedPath,
  pickCsvFile,
  subscribeFileDrop,
  type LoadedCsv,
} from "@/features/data/lib/filePick";

export function FilePickStep(props: {
  onLoaded: (file: LoadedCsv) => void;
  onError: (error: unknown) => void;
}) {
  const { onLoaded, onError } = props;
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
    <div className="flex flex-col gap-[var(--space-5)]">
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
          "rounded-[var(--radius-lg)] border-2 border-dashed px-[var(--space-6)] py-[var(--space-10)]",
          "text-center transition-colors",
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        ].join(" ")}
      >
        <FileSpreadsheet
          size={40}
          className="text-[var(--color-text-faint)]"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
            Drop a spreadsheet here
          </p>
          <p className="max-w-[46ch] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            A CSV exported from HubSpot, Zoho, Pipedrive, Google Contacts, or
            saved out of Excel. Helix works out the columns; you check them
            before anything is written.
          </p>
        </div>
        <Button
          ref={buttonRef}
          variant="primary"
          size="lg"
          loading={busy}
          iconLeft={<FolderOpen size={18} aria-hidden="true" />}
          onClick={() => void run(pickCsvFile)}
        >
          Choose a file
        </Button>
      </div>

      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Helix imports people and their companies. Deals, tasks and notes stay
        where they are for now.
      </p>
    </div>
  );
}
