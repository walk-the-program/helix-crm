/**
 * The last step: what happened, and the things the owner may want next - the
 * rows that did not go in, the ones Helix had to make a judgement call on, and
 * the records themselves.
 *
 * Counts, nouns and the destination button all come from the view
 * (`lib/importResultView.ts`), so this file is the same whether the file that
 * just landed held people, businesses or jobs.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Buildings, Download, Kanban, Tag, Users } from "@/ui/icons";
import { Button, Card, CardBody, CardRow, toast } from "@/ui";
import { rowsToCsv } from "@/lib/csv";
import { pickSavePath, writeTextFileAt } from "@/features/data/lib/fsBridge";
import type { ResultView } from "@/features/data/lib/importResultView";

/** The glyph for the destination button, keyed by what was just imported. */
const DESTINATION_ICONS = {
  people: Users,
  board: Kanban,
  buildings: Buildings,
  tag: Tag,
} as const;

function Count(props: { value: number; label: string; tone?: "accent" | "muted" }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span
        className={[
          "font-[family-name:var(--font-heading)] text-[length:var(--text-heading)] font-bold leading-[var(--leading-heading)] tabular-nums",
          props.tone === "muted" ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]",
        ].join(" ")}
      >
        {props.value.toLocaleString()}
      </span>
      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {props.label}
      </span>
    </div>
  );
}

/** How many warnings to list before the CSV is the better way to read them. */
const WARNINGS_SHOWN = 12;

export function ResultStep(props: {
  view: ResultView;
  fileName: string;
  onImportAnother: () => void;
}) {
  const { view, fileName, onImportAnother } = props;
  const [savingSkipped, setSavingSkipped] = useState(false);
  const [savingWarnings, setSavingWarnings] = useState(false);

  const seconds = Math.max(0.1, view.durationMs / 1000);
  const DestinationIcon = DESTINATION_ICONS[view.destination.icon];

  async function saveSkipped() {
    setSavingSkipped(true);
    try {
      const headers = [...view.headers, "Why Helix skipped it"];
      const rows = view.skippedRows.map((row) => {
        const cells =
          row.cells.length > 0 ? [...row.cells] : Array<string>(view.headers.length).fill("");
        while (cells.length < view.headers.length) cells.push("");
        return [...cells.slice(0, view.headers.length), row.reason];
      });
      const path = await pickSavePath({
        title: "Save the skipped rows",
        defaultPath: `skipped-${fileName}`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path === null) return;
      await writeTextFileAt(path, rowsToCsv(headers, rows));
      toast.success(`Saved ${rows.length.toLocaleString()} skipped rows.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the file.");
    } finally {
      setSavingSkipped(false);
    }
  }

  async function saveWarnings() {
    setSavingWarnings(true);
    try {
      const headers = ["Row", "Column", "What Helix did"];
      const rows = view.warnings.map((warning) => [
        String(warning.rowNumber),
        warning.column ?? "",
        warning.message,
      ]);
      const path = await pickSavePath({
        title: "Save what Helix noticed",
        defaultPath: `warnings-${fileName}`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path === null) return;
      await writeTextFileAt(path, rowsToCsv(headers, rows));
      toast.success(`Saved ${rows.length.toLocaleString()} warnings.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the file.");
    } finally {
      setSavingWarnings(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <Card>
        <CardBody className="flex flex-wrap gap-[var(--space-9)] p-[var(--space-6)]">
          {view.counts.map((count) => (
            <Count
              key={count.label}
              value={count.value}
              label={count.label}
              tone={count.label === "rows skipped" ? "muted" : undefined}
            />
          ))}
        </CardBody>
      </Card>

      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {view.totalRows.toLocaleString()} rows from {fileName} in{" "}
        <span className="tabular-nums">{seconds.toFixed(1)}s</span>
        {view.extras.map((extra) => `, ${extra}`).join("")}.
      </p>

      {view.warnings.length > 0 ? (
        <Card>
          <CardRow className="flex-wrap py-[var(--space-3)]">
            <span className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <span className="font-medium text-[var(--color-text)]">
                {view.warnings.length.toLocaleString()}{" "}
                {view.warnings.length === 1 ? "row" : "rows"} Helix had to decide
                something about
              </span>
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Everything went in. These are the places the file did not quite
                match your workspace.
                {view.warningsTruncated ? " Only the first 5,000 are listed." : ""}
              </span>
            </span>
            <Button
              variant="secondary"
              onClick={() => void saveWarnings()}
              loading={savingWarnings}
              loadingLabel="Saving…"
              iconLeft={<Download size={16} weight="bold" aria-hidden="true" />}
            >
              Save warnings as CSV
            </Button>
          </CardRow>
          <CardBody className="p-[var(--space-6)] pt-[var(--space-4)]">
            <ul className="flex flex-col gap-[var(--space-2)]">
              {view.warnings.slice(0, WARNINGS_SHOWN).map((warning, i) => (
                <li
                  key={`${warning.rowNumber}-${i}`}
                  className="flex gap-[var(--space-3)] text-[length:var(--text-sm)]"
                >
                  <span className="w-[4rem] flex-none tabular-nums text-[var(--color-text-faint)]">
                    Row {warning.rowNumber}
                  </span>
                  <span className="text-[var(--color-text-muted)]">{warning.message}</span>
                </li>
              ))}
            </ul>
            {view.warnings.length > WARNINGS_SHOWN ? (
              <p className="pt-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
                And {(view.warnings.length - WARNINGS_SHOWN).toLocaleString()} more. The
                CSV has all of them.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {view.skipped > 0 ? (
        <Card>
          <CardRow className="flex-wrap py-[var(--space-3)]">
            <span className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <span className="font-medium text-[var(--color-text)]">
                {view.skipped.toLocaleString()} rows did not go in
              </span>
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Save them as their own CSV, fix them in a spreadsheet, and import
                that file.
                {view.skippedTruncated ? " Only the first 5,000 are saved." : ""}
              </span>
            </span>
            <Button
              variant="secondary"
              onClick={() => void saveSkipped()}
              loading={savingSkipped}
              loadingLabel="Saving…"
              iconLeft={<Download size={16} weight="bold" aria-hidden="true" />}
            >
              Save skipped rows as CSV
            </Button>
          </CardRow>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Link href={view.destination.href}>
          <Button
            variant="primary"
            iconLeft={<DestinationIcon size={16} weight="bold" aria-hidden="true" />}
          >
            {view.destination.label}
          </Button>
        </Link>
        <Link href="/duplicates">
          <Button variant="secondary">Check for duplicates</Button>
        </Link>
        <Button variant="ghost" onClick={onImportAnother}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
