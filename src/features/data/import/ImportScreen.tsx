/**
 * The CSV import wizard.
 *
 *   pick -> map -> preview -> running -> result
 *     ^                                    |
 *     +------------- import another -------+
 *
 * Nothing is written before "Import": the file is read, sniffed and mapped in
 * memory, and the write happens in one transaction (lib/importRun.ts for
 * contacts, lib/typedImportRun.ts for everything else).
 *
 * The first step asks what is in the file before it asks for the file, because
 * the answer changes every screen after it: which columns the guesser knows,
 * which fields the preview shows, and which duplicate question is worth asking.
 * Contacts is the default and the contacts path is untouched - it is the one
 * import with a year of fixtures behind it.
 *
 * The shape is a macOS setup assistant (docs/DESIGN.md section 1): a quiet
 * trail of step names in the canvas, one panel of content under it, and the two
 * buttons that move the assistant pinned to the bottom right - Back, then the
 * single primary button for the step. Nothing else on the step is coloured, and
 * that includes the examples menu in the header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Upload } from "@/ui/icons";
import { Button, Card, CardBody, EmptyState, PageHeader, Spinner, toast } from "@/ui";
import type { ImportParseError } from "@/lib/csv";
import type { LoadedCsv } from "@/features/data/lib/filePick";
import { applyMapping, type ColumnMapping, type MappedRow } from "@/features/data/lib/mapping";
import {
  SKIP,
  readDraftRow,
  type DraftRow,
  type TypedColumnMapping,
} from "@/features/data/lib/typedMapping";
import {
  initialMapping,
  initialTypedMapping,
  rememberMapping,
  rememberTypedMapping,
} from "@/features/data/lib/rememberMapping";
import {
  estimateDuplicateMatches,
  runImport,
  type DedupePolicy,
  type DuplicateEstimate,
  type ImportProgress,
} from "@/features/data/lib/importRun";
import { runTypedImport } from "@/features/data/lib/typedImportRun";
import {
  contactsResultView,
  typedResultView,
  type ResultView,
} from "@/features/data/lib/importResultView";
import { DEFAULT_IMPORT_TYPE, importType } from "@/features/data/import/fields/index";
import type { ImportTypeId } from "@/features/data/import/fields/types";
import { FilePickStep } from "@/features/data/import/FilePickStep";
import { MappingStep } from "@/features/data/import/MappingStep";
import { PreviewStep } from "@/features/data/import/PreviewStep";
import { TypedMappingStep } from "@/features/data/import/TypedMappingStep";
import { TypedPreviewStep } from "@/features/data/import/TypedPreviewStep";
import { ResultStep } from "@/features/data/import/ResultStep";
import { ProgressBar } from "@/features/data/import/ProgressBar";
import { TypePicker } from "@/features/data/import/TypePicker";
import { ExamplesMenu } from "@/features/data/import/ExamplesMenu";
import { HelpLink } from "@/features/help";

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
 * A native assistant states the step names in a row and lets weight and ink
 * carry the position: the current step is full-strength ink at weight 500, the
 * ones behind it are secondary, the ones ahead are tertiary, and a hairline
 * joins them.
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
  nextDisabled?: boolean;
}) {
  const { onBack, backLabel, onNext, nextLabel, nextIcon, nextDisabled } = props;
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
        disabled={nextDisabled}
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
          <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            <HelpLink to="customers-in">What Helix expects a file to look like</HelpLink>
          </span>
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
  const [typeId, setTypeId] = useState<ImportTypeId>(DEFAULT_IMPORT_TYPE);
  const [file, setFile] = useState<LoadedCsv | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [totalPreviewed, setTotalPreviewed] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [typedMapping, setTypedMapping] = useState<TypedColumnMapping[]>([]);
  const [signature, setSignature] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [policy, setPolicy] = useState<DedupePolicy>("skip");
  const [duplicateEstimate, setDuplicateEstimate] = useState<DuplicateEstimate | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [view, setView] = useState<ResultView | null>(null);
  const [parseError, setParseError] = useState<ImportParseError | null>(null);
  const [emptyFile, setEmptyFile] = useState(false);
  /**
   * The human word for the file's delimiter ("comma", "semicolon"...),
   * computed once in `onLoaded` alongside the dynamic `@/lib/csv` import
   * rather than at render time, so the subtitle never has to call into that
   * module directly.
   */
  const [delimiterWord, setDelimiterWord] = useState("");
  const headingRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);

  const type = importType(typeId);
  const isLegacy = type.legacy === true;

  // Moving between steps should move the keyboard too — but not on the very
  // first mount, where focus() would scroll the fresh page under its own
  // title before the owner has done anything (F-LC-5).
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const reset = useCallback(() => {
    setStep("pick");
    setFile(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping([]);
    setTypedMapping([]);
    setView(null);
    setParseError(null);
    setEmptyFile(false);
    setDelimiterWord("");
    setProgress(null);
    setPolicy("skip");
    setDuplicateEstimate(null);
  }, []);

  const onLoaded = useCallback(
    async (loaded: LoadedCsv) => {
      setParseError(null);
      setEmptyFile(false);
      // papaparse (behind @/lib/csv) is only worth downloading once a file has
      // actually been picked, so it is loaded here rather than at the top of
      // this module.
      const { walkCsv, delimiterLabel, ImportParseError } = await import("@/lib/csv");
      try {
        // `walkCsv` with no `limit` walks the whole file - which is what a
        // correct row count needs - but only the first PREVIEW_ROWS rows are
        // kept in memory here; the rest are counted and discarded as they are
        // read. `parseCsvText({ limit: PREVIEW_ROWS })` used to feed this
        // screen: it aborts after 20 rows, so its `rowCount` was never the
        // file's total, it was `min(totalRows, 20)`. On anything past 20 rows
        // the preview step said "The first 20 of 20 rows" for a file that
        // might have three thousand, which told the owner nothing true about
        // how much was about to be imported.
        const sample: string[][] = [];
        const { headers, rowCount } = walkCsv(loaded.text, { delimiter: loaded.delimiter }, (cells) => {
          if (sample.length < PREVIEW_ROWS) sample.push(cells);
        });
        setFile(loaded);
        setDelimiterWord(delimiterLabel(loaded.delimiter));
        setHeaders(headers);
        setSampleRows(sample);
        setTotalPreviewed(rowCount);
        if (rowCount === 0) {
          setEmptyFile(true);
          return;
        }
        if (isLegacy) {
          const initial = await initialMapping(headers);
          setMapping(initial.mapping);
          setSignature(initial.signature);
          setRemembered(initial.remembered);
        } else {
          const initial = await initialTypedMapping(type, headers);
          setTypedMapping(initial.mapping);
          setSignature(initial.signature);
          setRemembered(initial.remembered);
        }
        setStep("map");
      } catch (err) {
        if (err instanceof ImportParseError) {
          setParseError(err);
          return;
        }
        throw err;
      }
    },
    [isLegacy, type],
  );

  const onError = useCallback(async (err: unknown) => {
    const { ImportParseError } = await import("@/lib/csv");
    if (err instanceof ImportParseError) {
      setParseError(err);
      return;
    }
    toast.error(err instanceof Error ? err.message : "Helix could not open that file.");
  }, []);

  const previewRows: MappedRow[] = useMemo(
    () =>
      isLegacy
        ? sampleRows.map((cells, i) => applyMapping(cells, mapping, i + 2, { region: undefined }))
        : [],
    [isLegacy, sampleRows, mapping],
  );

  const typedPreviewRows: DraftRow[] = useMemo(
    () =>
      isLegacy
        ? []
        : sampleRows.map((cells, i) => readDraftRow(type, cells, typedMapping, i + 2)),
    [isLegacy, sampleRows, typedMapping, type],
  );

  const mappedFieldKeys = useMemo(
    () => typedMapping.filter((m) => m.field !== SKIP).map((m) => m.field),
    [typedMapping],
  );

  /** A required field with no column behind it: there is nothing to import. */
  const missingRequired = useMemo(
    () =>
      isLegacy
        ? false
        : type.fields.some(
            (field) =>
              field.required === true && !typedMapping.some((m) => m.field === field.key),
          ),
    [isLegacy, type, typedMapping],
  );

  // The preview's policy choice ("Skip them" / "Fill in the blanks" / "Import
  // anyway") describes what happens to a match, but not how many rows that
  // touches - the owner had no way to know that before committing. This reads
  // the whole file against the workspace's real emails and phones (no write
  // lock, no transaction) as soon as the preview step opens, for the contacts
  // path only: the other three import types resolve duplicates differently
  // per type and are not covered by this pass.
  useEffect(() => {
    if (step !== "preview" || !isLegacy || !file) return;
    let cancelled = false;
    setDuplicateEstimate(null);
    void estimateDuplicateMatches(file.text, mapping, { delimiter: file.delimiter }).then(
      (estimate) => {
        if (!cancelled) setDuplicateEstimate(estimate);
      },
      () => {
        // A failed estimate is not worth blocking or alarming the owner over:
        // the import itself still runs the real lookups. The preview simply
        // shows nothing extra.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [step, isLegacy, file, mapping]);

  async function startImport() {
    if (!file) return;
    setStep("running");
    setProgress({ phase: "reading", processed: 0, total: 0 });
    try {
      if (isLegacy) {
        await rememberMapping(signature, mapping);
        const outcome = await runImport({
          text: file.text,
          mapping,
          delimiter: file.delimiter,
          policy,
          onProgress: setProgress,
        });
        setView(contactsResultView(outcome));
        setStep("result");
        await queryClient.invalidateQueries();
        toast.success(
          `${outcome.created.toLocaleString()} created, ${outcome.updated.toLocaleString()} updated.`,
        );
        return;
      }

      await rememberTypedMapping(signature, typedMapping);
      const outcome = await runTypedImport({
        typeId,
        text: file.text,
        mapping: typedMapping,
        delimiter: file.delimiter,
        policy,
        onProgress: setProgress,
      });
      setView(typedResultView(outcome));
      setStep("result");
      await queryClient.invalidateQueries();
      toast.success(
        `${outcome.created.toLocaleString()} created, ${outcome.skipped.toLocaleString()} skipped.`,
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
    ? `${file.name} · ${delimiterWord}-separated · ${file.encoding}${
        file.hadBom ? " with BOM" : ""
      }`
    : "Bring a spreadsheet or another CRM in.";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Import"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            {step !== "pick" && step !== "running" ? (
              <Button variant="ghost" onClick={reset}>
                Start over
              </Button>
            ) : null}
            <ExamplesMenu />
          </div>
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
          <>
            <TypePicker value={typeId} onChange={setTypeId} />
            <FilePickStep typeLabel={type.label} onLoaded={(f) => void onLoaded(f)} onError={onError} />
          </>
        ) : null}

        {step === "map" && isLegacy ? (
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

        {step === "map" && !isLegacy ? (
          <>
            <TypedMappingStep
              type={type}
              sampleRows={sampleRows}
              mapping={typedMapping}
              remembered={remembered}
              onChange={setTypedMapping}
            />
            <StepFooter
              onBack={reset}
              backLabel="Back"
              onNext={() => setStep("preview")}
              nextLabel="Continue"
              nextIcon="continue"
              nextDisabled={missingRequired}
            />
          </>
        ) : null}

        {step === "preview" && isLegacy ? (
          <>
            <PreviewStep
              rows={previewRows}
              totalRows={totalPreviewed}
              policy={policy}
              onPolicyChange={setPolicy}
              duplicateEstimate={duplicateEstimate}
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

        {step === "preview" && !isLegacy ? (
          <>
            <TypedPreviewStep
              type={type}
              rows={typedPreviewRows}
              mappedFieldKeys={mappedFieldKeys}
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

        {step === "result" && view ? (
          <ResultStep
            view={view}
            fileName={file?.name ?? "your file"}
            onImportAnother={reset}
          />
        ) : null}
      </div>
    </div>
  );
}
