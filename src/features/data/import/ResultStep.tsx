/**
 * Step 5: what happened, and the two things the owner may want next - the
 * rows that did not go in, and the contacts that did.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Download, Users } from "lucide-react";
import { Button, Card, CardBody, toast } from "@/ui";
import { rowsToCsv } from "@/lib/csv";
import { pickSavePath, writeTextFileAt } from "@/features/data/lib/fsBridge";
import type { ImportResult } from "@/features/data/lib/importRun";

function Count(props: { value: number; label: string; tone?: "accent" | "muted" }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span
        className={[
          "text-[length:var(--text-2xl)] font-semibold tabular-nums",
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

export function ResultStep(props: {
  result: ImportResult;
  fileName: string;
  onImportAnother: () => void;
}) {
  const { result, fileName, onImportAnother } = props;
  const [saving, setSaving] = useState(false);

  const seconds = Math.max(0.1, result.durationMs / 1000);

  async function saveSkipped() {
    setSaving(true);
    try {
      const headers = [...result.headers, "Why Helix skipped it"];
      const rows = result.skippedRows.map((row) => {
        const cells =
          row.cells.length > 0
            ? [...row.cells]
            : Array<string>(result.headers.length).fill("");
        while (cells.length < result.headers.length) cells.push("");
        return [...cells.slice(0, result.headers.length), row.reason];
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
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <Card>
        <CardBody className="flex flex-wrap gap-[var(--space-10)]">
          <Count value={result.created} label="contacts created" />
          <Count value={result.updated} label="contacts updated" />
          <Count value={result.skipped} label="rows skipped" tone="muted" />
          <Count value={result.companiesCreated} label="companies created" />
        </CardBody>
      </Card>

      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {result.totalRows.toLocaleString()} rows from {fileName} in{" "}
        <span className="tabular-nums">{seconds.toFixed(1)}s</span>
        {result.tagsCreated > 0
          ? `, ${result.tagsCreated} new tag${result.tagsCreated === 1 ? "" : "s"}`
          : ""}
        {result.customFieldsCreated > 0
          ? `, ${result.customFieldsCreated} new custom field${
              result.customFieldsCreated === 1 ? "" : "s"
            }`
          : ""}
        .
      </p>

      {result.skipped > 0 ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
            <div className="flex flex-col gap-[var(--space-1)]">
              <span className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                {result.skipped.toLocaleString()} rows did not go in
              </span>
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Save them as their own CSV, fix them in a spreadsheet, and
                import that file.
                {result.skippedTruncated
                  ? " Only the first 5,000 are saved."
                  : ""}
              </span>
            </div>
            <Button
              onClick={() => void saveSkipped()}
              loading={saving}
              iconLeft={<Download size={16} aria-hidden="true" />}
            >
              Save skipped rows as CSV
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-[var(--space-3)]">
        <Link href="/contacts">
          <Button variant="primary" iconLeft={<Users size={16} aria-hidden="true" />}>
            See the contacts
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
