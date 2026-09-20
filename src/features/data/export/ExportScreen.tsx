/**
 * The "/export" screen: one grouped list for the "everything" zip and one for
 * per-entity CSVs, each with its live row count. Every write goes through
 * exportRun.ts, which itself only ever touches the filesystem through
 * fsBridge (the dialog, then the write).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Archive, Download } from "@/ui/icons";
import {
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  EmptyState,
  PageHeader,
  toast,
} from "@/ui";
import { dqk } from "@/features/data/lib/queries";
import { basenameOf } from "@/features/data/lib/fsBridge";
import {
  EXPORT_ENTITIES,
  entityLabel,
  exportCounts,
  saveEntityCsv,
  saveEverythingZip,
  type ExportEntity,
} from "@/features/data/lib/exportRun";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ExportScreen() {
  const countsQuery = useQuery({
    queryKey: dqk.exportCounts(),
    queryFn: exportCounts,
  });

  const [savingEntity, setSavingEntity] = useState<ExportEntity | null>(null);
  const [savingZip, setSavingZip] = useState(false);

  const counts = countsQuery.data;
  const totalRows = counts
    ? EXPORT_ENTITIES.reduce((sum, entity) => sum + counts[entity], 0)
    : null;
  const isEmpty = totalRows === 0;

  async function handleExportEntity(entity: ExportEntity) {
    setSavingEntity(entity);
    try {
      const { path } = await saveEntityCsv(entity);
      // A cancelled dialog returns path: null and writes nothing - silent.
      if (path) {
        toast.success(`Exported ${entityLabel(entity)} to ${basenameOf(path)}`);
      }
    } catch (err) {
      toast.error(`Couldn't export ${entityLabel(entity)}: ${errorMessage(err)}`);
    } finally {
      setSavingEntity(null);
    }
  }

  async function handleExportEverything() {
    setSavingZip(true);
    try {
      const { path } = await saveEverythingZip();
      if (path) {
        toast.success(`Exported everything to ${basenameOf(path)}`);
      }
    } catch (err) {
      toast.error(`Couldn't export everything: ${errorMessage(err)}`);
    } finally {
      setSavingZip(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/*
        The subtitle describes what is on the screen, so it goes away when
        nothing is: "Export any list as CSV" above "Nothing to export yet" is a
        page contradicting itself, and the empty state's own sentence is the
        true one (phase-two design direction, rule 6).
      */}
      <PageHeader
        title="Export"
        subtitle={
          isEmpty ? undefined : "This data is yours to take. Export any list as CSV, or everything at once."
        }
      />
      <div className="flex flex-col gap-[var(--space-6)]">
        {isEmpty ? (
          <EmptyState
            title="Nothing to export yet"
            description="Add contacts and companies, then come back to export them."
            action={
              <Link href="/import">
                <Button variant="primary">Import your data</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div>
              <CardGroupLabel>Everything</CardGroupLabel>
              <Card>
                <CardRow>
                  <div className="flex min-w-0 max-w-[var(--content-max)] flex-col gap-[var(--space-1)]">
                    <span className="font-medium text-[var(--color-text)]">
                      Everything, as one file
                    </span>
                    {/*
                      Three lines listing the tables was a standing explanation
                      of a button (rule 3). One line says the thing that
                      actually decides it — everything, nothing left out — and
                      the full list is in the zip itself, where it can be read
                      rather than remembered.
                    */}
                    <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                      One .zip holding a CSV of every table, plus a JSON file that is the
                      complete copy.
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    iconLeft={<Archive size={16} weight="bold" aria-hidden="true" />}
                    loading={savingZip}
                    onClick={handleExportEverything}
                  >
                    Export everything (.zip)
                  </Button>
                </CardRow>
              </Card>
            </div>

            <div>
              <CardGroupLabel>By list</CardGroupLabel>
              <Card>
                {EXPORT_ENTITIES.map((entity) => {
                  const count = counts ? counts[entity] : null;
                  return (
                    <CardRow key={entity}>
                      <span className="font-medium text-[var(--color-text)]">
                        {entityLabel(entity)}
                      </span>
                      <div className="flex items-center gap-[var(--space-3)]">
                        <span className="text-[length:var(--text-sm)]">
                          <span className="tabular-nums text-[var(--color-text-muted)]">
                            {count === null ? "-" : count}
                          </span>{" "}
                          <span className="text-[var(--color-text-faint)]">
                            {count === 1 ? "record" : "records"}
                          </span>
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<Download size={16} weight="bold" aria-hidden="true" />}
                          loading={savingEntity === entity}
                          disabled={count === 0}
                          onClick={() => handleExportEntity(entity)}
                        >
                          Export CSV
                        </Button>
                      </div>
                    </CardRow>
                  );
                })}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
