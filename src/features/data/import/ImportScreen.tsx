/**
 * The CSV import wizard.
 *
 *   pick -> map -> preview -> running -> result
 *     ^                                    |
 *     +------------- import another -------+
 *
 * Nothing is written before "Import": the file is read, sniffed and mapped in
 * memory, and the write happens in one transaction (see lib/importRun.ts).
 *
 * The shape is a macOS setup assistant (docs/DESIGN.md §1): a quiet trail of
 * step names in the canvas, one panel of content under it, and the two buttons
 * that move the assistant pinned to the bottom right - Back, then the single
 * primary button for the step. Nothing else on the step is coloured.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Upload } from "@/ui/icons";
import { Button, Card, CardBody, EmptyState, PageHeader, Spinner, toast } from "@/ui";
import {
  ImportParseError,
  delimiterLabel,
  parseCsvText,
} from "@/lib/csv";
import type { LoadedCsv } from "@/features/data/lib/filePick";
import { applyMapping, type ColumnMapping, type MappedRow } from "@/features/data/lib/mapping";
import {
  initialMapping,
  rememberMapping,
} from "@/features/data/lib/rememberMapping";
import {
  runImport,
  type DedupePolicy,
  type ImportProgress,
  type ImportResult,
} from "@/features/data/lib/importRun";
import { FilePickStep } from "@/features/data/import/FilePickStep";
import { MappingStep } from "@/features/data/import/MappingStep";
import { PreviewStep } from "@/features/data/import/PreviewStep";
import { ResultStep } from "@/features/data/import/ResultStep";
import { ProgressBar } from "@/features/data/import/ProgressBar";

type Step = "pick" | "map" | "preview" | "running" | "result";

const STEP_LABELS: { id: Step; label: string }[] = [
  { id: "pick", label: "Choose a file" },
  { id: "map", label: "Match the columns" },
  { id: "preview", label: "Check 20 rows" },
  { id: "result", label: "Done" },
];

const PREVIEW_ROWS = 20;

/**
 * Where the owner is, in words.
 *
 * The old trail was four tinted pills, one of them green - four filled shapes
 * and two colours to say one thing. A native assistant states the step names
 * in a row and lets weight and ink carry the position: the current step is
 * full-strength ink at weight 500, the ones behind it are secondary, the ones
 * ahead are tertiary, and a hairline joins them.
 */
function StepTrail({ step }: { step: Step }) {
  const current = step === "running" ? "preview" : step;
  const index = STEP_LABELS.findIndex((s) => s.id === current);

  return (
    <nav aria-label="Import steps">
      <ol className="flex flex-wrap items-center gap-[var(--space-3)] text-[length:var(--text-sm)]">
        {STEP_LABELS.map((entry, i) => {
          const state = i < index ? "done" : i === index ? "current" : "todo";
          return (
            <li key={entry.id} className="flex items-center gap-[var(--space-3)]">
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={
                  state === "current"
                    ? "font-medium text-[var(--color-text)]"
                    : state === "done"
                      ? "text-[var(--color-text-muted)]"
                      : "text-[var(--color-text-faint)]"
                }
              >
                {entry.label}
              </span>
              {i < STEP_LABELS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="h-[var(--hairline)] w-[var(--space-5)] flex-none bg-[var(--color-border-strong)]"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Back on the left of the pair, the one black button on the right. */
function StepFooter(props: {
  onBack: () => void;
  backLabel: string;
  onNext: () => void;
  nextLabel: string;
  nextIcon: "continue" | "import";
}) {
  const { onBack, backLabel, onNext, nextLabel, nextIcon } = props;
  return (
    <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
      <Button
        variant="secondary"
        onClick={onBack}
        iconLeft={<ArrowLeft size={16} weight="bold" aria-hidden="true" />}
      >
        {backLabel}
      </Button>
      <Button
        variant="primary"
        onClick={onNext}
        iconLeft={
          nextIcon === "import" ? <Upload size={16} weight="bold" aria-hidden="true" /> : undefined
        }
        iconRight={
          nextIcon === "continue" ? (
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          ) : undefined
        }
      >
        {nextLabel}
      </Button>
    </div>
  );
}

function ParseFailure(props: { error: ImportParseError; onRetry: () => void }) {
  const { error, onRetry } = props;
  return (
    <EmptyState
      title="Helix could not read that file"
      description={
        <span className="flex flex-col items-center gap-[var(--space-3)]">
          <span>{error.message}</span>
          {error.sample ? (
            <code className="bg-[var(--color-accent-soft)] px-[var(--space-2)] py-[var(--space-1)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
              {error.sample}
            </code>
          ) : null}
          <span>Fix that row in a spreadsheet, save it again, and try once more.</span>
        </span>
      }
      action={
        <Button variant="primary" onClick={onRetry}>
          Choose another file
        </Button>
      }
    />
  );
}

export function ImportScreen() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<LoadedCsv | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [totalPreviewed, setTotalPreviewed] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [signature, setSignature] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [policy, setPolicy] = useState<DedupePolicy>("skip");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<ImportParseError | null>(null);
  const [emptyFile, setEmptyFile] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

  // Moving between steps should move the keyboard too.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const reset = useCallback(() => {
    setStep("pick");
    setFile(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping([]);
    setResult(null);
    setParseError(null);
    setEmptyFile(false);
    setProgress(null);
  }, []);

  const onLoaded = useCallback(async (loaded: LoadedCsv) => {
    setParseError(null);
    setEmptyFile(false);
    try {
      const preview = parseCsvText(loaded.text, {
        delimiter: loaded.delimiter,
        limit: PREVIEW_ROWS,
      });
      setFile(loaded);
      setHeaders(preview.headers);
      setSampleRows(preview.rows);
      setTotalPreviewed(preview.rowCount);
      if (preview.rowCount === 0) {
        setEmptyFile(true);
        return;
      }
      const initial = await initialMapping(preview.headers);
      setMapping(initial.mapping);
      setSignature(initial.signature);
      setRemembered(initial.remembered);
      setStep("map");
    } catch (err) {
      if (err instanceof ImportParseError) {
        setParseError(err);
        return;
      }
      throw err;
    }
  }, []);

  const onError = useCallback((err: unknown) => {
    if (err instanceof ImportParseError) {
      setParseError(err);
      return;
    }
    toast.error(err instanceof Error ? err.message : "Helix could not open that file.");
  }, []);

  const previewRows: MappedRow[] = useMemo(
    () =>
      sampleRows.map((cells, i) =>
        applyMapping(cells, mapping, i + 2, { region: undefined }),
      ),
    [sampleRows, mapping],
  );

  async function startImport() {
    if (!file) return;
    setStep("running");
    setProgress({ phase: "reading", processed: 0, total: 0 });
    try {
      await rememberMapping(signature, mapping);
      const outcome = await runImport({
        text: file.text,
        mapping,
        delimiter: file.delimiter,
        policy,
        onProgress: setProgress,
      });
      setResult(outcome);
      setStep("result");
      await queryClient.invalidateQueries();
      toast.success(
        `${outcome.created.toLocaleString()} created, ${outcome.updated.toLocaleString()} updated.`,
      );
    } catch (err) {
      setStep("preview");
      toast.error(
        err instanceof Error
          ? err.message
          : "Nothing was imported. Helix could not write to the database.",
      );
    }
  }

  const subtitle = file
    ? `${file.name} · ${delimiterLabel(file.delimiter)}-separated · ${file.encoding}${
        file.hadBom ? " with BOM" : ""
      }`
    : "Bring a spreadsheet or another CRM in.";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Import"
        subtitle={subtitle}
        actions={
          step !== "pick" && step !== "running" ? (
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
          ) : null
        }
      />

      <div
        ref={headingRef}
        tabIndex={-1}
        className="flex flex-col gap-[var(--space-6)] outline-none"
      >
        <StepTrail step={step} />

        {step === "pick" && parseError ? (
          <ParseFailure error={parseError} onRetry={() => setParseError(null)} />
        ) : null}

        {step === "pick" && !parseError && emptyFile ? (
          <EmptyState
            title="This file has headers but no rows"
            description="There is nothing to import yet. Add some rows in your spreadsheet and save it again."
            action={
              <Button variant="primary" onClick={reset}>
                Choose another file
              </Button>
            }
          />
        ) : null}

        {step === "pick" && !parseError && !emptyFile ? (
          <FilePickStep onLoaded={(f) => void onLoaded(f)} onError={onError} />
        ) : null}

        {step === "map" ? (
          <>
            <MappingStep
              headers={headers}
              sampleRows={sampleRows}
              mapping={mapping}
              remembered={remembered}
              onChange={setMapping}
            />
            <StepFooter
              onBack={reset}
              backLabel="Back"
              onNext={() => setStep("preview")}
              nextLabel="Continue"
              nextIcon="continue"
            />
          </>
        ) : null}

        {step === "preview" ? (
          <>
            <PreviewStep
              rows={previewRows}
              totalRows={totalPreviewed}
              policy={policy}
              onPolicyChange={setPolicy}
            />
            <StepFooter
              onBack={() => setStep("map")}
              backLabel="Back"
              onNext={() => void startImport()}
              nextLabel="Import"
              nextIcon="import"
            />
          </>
        ) : null}

        {step === "running" ? (
          <Card>
            <CardBody className="flex flex-col gap-[var(--space-5)] p-[var(--space-6)]">
              <div className="flex items-center gap-[var(--space-3)]">
                <Spinner size={18} />
                <span className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                  {progress?.phase === "reading"
                    ? "Reading your file…"
                    : "Writing to your workspace…"}
                </span>
              </div>
              <ProgressBar
                label={
                  progress?.phase === "reading"
                    ? "Rows read"
                    : `Rows imported (${(progress?.processed ?? 0).toLocaleString()} of ${(
                        progress?.total ?? 0
                      ).toLocaleString()})`
                }
                value={progress?.processed ?? 0}
                max={progress?.total ?? 0}
                indeterminate={progress?.phase === "reading"}
              />
              <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                It all goes in at once, so if anything fails nothing is left half
                imported. Other changes wait until this finishes.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {step === "result" && result ? (
          <ResultStep
            result={result}
            fileName={file?.name ?? "your file"}
            onImportAnother={reset}
          />
        ) : null}
      </div>
    </div>
  );
}
