/**
 * The "/export" screen: one card per entity with its live row count and a
 * CSV button, plus a prominent "export everything" zip action. Every write
 * goes through exportRun.ts, which itself only ever touches the filesystem
 * through fsBridge (the dialog, then the write).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Archive, Download } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
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
    <div>
      <PageHeader
        title="Export"
        subtitle="This data is yours to take. Export any list as CSV, or everything at once."
      />
      <div className="flex flex-col gap-[var(--space-5)] pt-[var(--space-6)]">
        {isEmpty ? (
          <EmptyState
            title="Nothing to export yet"
            description={
              <>
                There is nothing in this workspace yet.{" "}
                <Link
                  href="/import"
                  className="text-[var(--color-accent)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2"
                >
                  Import your data
                </Link>{" "}
                to get started.
              </>
            }
          />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Export everything</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  One .zip containing a CSV for every entity - contacts, companies, deals,
                  tasks and activities - plus a full JSON dump of the whole workspace.
                </p>
              </CardBody>
              <CardFooter>
                <Button
                  variant="primary"
                  iconLeft={
                    <Archive className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
                  }
                  loading={savingZip}
                  onClick={handleExportEverything}
                >
                  Export everything (.zip)
                </Button>
              </CardFooter>
            </Card>

            <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
              {EXPORT_ENTITIES.map((entity) => {
                const count = counts ? counts[entity] : null;
                return (
                  <Card key={entity}>
                    <CardHeader>
                      <CardTitle>{entityLabel(entity)}</CardTitle>
                    </CardHeader>
                    <CardBody className="flex flex-col gap-[var(--space-1)]">
                      <p className="text-[length:var(--text-2xl)] font-semibold tabular-nums text-[var(--color-text)]">
                        {count === null ? "-" : count}
                      </p>
                      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        {count === 1 ? "record" : "records"}
                      </p>
                    </CardBody>
                    <CardFooter>
                      <Button
                        variant="secondary"
                        iconLeft={
                          <Download
                            className="w-[var(--space-4)] h-[var(--space-4)]"
                            aria-hidden="true"
                          />
                        }
                        loading={savingEntity === entity}
                        disabled={count === 0}
                        onClick={() => handleExportEntity(entity)}
                      >
                        Export CSV
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
