/**
 * The backups screen - list, run, and restore (docs/PLAN.md item 17).
 *
 * The scheduler (./scheduler.ts) runs backups in the background; this screen
 * shows what happened, lets the owner force one, and rolls back to an
 * earlier file. A restore blocks the screen until it settles, because a
 * half-finished restore next to a live UI is how data gets lost.
 *
 * The route is "/settings/backups" and the settings feature mounts it; this
 * folder owns the screen, the scheduler and the retention policy.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Warning } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from "@/ui";
import { formatDateDisplay, formatDateTimeDisplay, todayLocal } from "@/lib/dates";
import { dqk } from "@/features/data/lib/queries";
import {
  listBackups,
  restoreFromBackup,
  runBackup,
  type BackupFile,
} from "@/features/data/lib/backupsFs";
import { formatBytes, totalBytes } from "@/features/data/lib/retention";
import { getBackupStatus, subscribeBackupStatus } from "@/features/data/backups/scheduler";
import { workspacePaths } from "@/features/data/lib/workspace";

function useBackupsDir(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void workspacePaths().then((paths) => {
      if (!cancelled) setDir(paths.backupsDir);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return dir;
}

export function BackupsScreen() {
  const queryClient = useQueryClient();
  const backupsDir = useBackupsDir();
  const status = useSyncExternalStore(subscribeBackupStatus, getBackupStatus, getBackupStatus);

  const backupsQuery = useQuery({
    queryKey: dqk.backups(),
    queryFn: () => listBackups(),
  });

  const backupNow = useMutation({
    mutationFn: () => runBackup("manual"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dqk.backups() });
      toast.success("Backup saved.");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Helix could not save a backup.");
    },
  });

  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);

  const restoreMutation = useMutation({
    mutationFn: (file: BackupFile) => restoreFromBackup(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dqk.backups() });
      toast.success("Restore complete.");
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error
          ? `Restore failed: ${err.message}. Please restart Helix.`
          : "Restore failed. Please restart Helix.",
      );
    },
  });

  const files = backupsQuery.data ?? [];
  const isBusy = restoreMutation.isPending;

  return (
    <div className="relative flex flex-col">
      <PageHeader
        title="Backups"
        subtitle="Helix backs up your database automatically."
        actions={
          // One black button per screen: while the list is empty the empty
          // state carries it, and the header's copy would be the second.
          files.length > 0 ? (
            <Button
              variant="primary"
              iconLeft={<DatabaseBackup size={16} weight="bold" aria-hidden="true" />}
              onClick={() => backupNow.mutate()}
              loading={backupNow.isPending}
              loadingLabel="Backing up…"
              disabled={isBusy}
            >
              Back up now
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-[var(--space-5)]">
        {status.lastError ? (
          <div
            role="alert"
            className={[
              "flex items-start gap-[var(--space-3)]",
              "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
              "bg-[var(--color-danger-soft)] px-[var(--space-4)] py-[var(--space-3)]",
              "text-[length:var(--text-sm)] text-[var(--color-danger-ink)]",
            ].join(" ")}
          >
            <Warning
              size={18}
              weight="regular"
              className="mt-[var(--space-1)] flex-none"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="font-medium">Helix could not save a backup</div>
              <div>{status.lastError}</div>
            </div>
          </div>
        ) : null}

        <p className="max-w-[var(--content-max)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Helix backs up after opening, unless one has run in the last hour, and every 6 hours
          after that. It keeps every backup from the last 24 hours, then one per day for 30
          days, and removes the rest. Backups cover the database only — attachments are plain
          files stored beside it and are not included.
        </p>

        {backupsQuery.isLoading ? (
          <div className="flex justify-center py-[var(--space-10)]">
            <Spinner label="Loading backups" />
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            title="No backups yet"
            description="Helix will back up automatically, or you can start one now."
            action={
              <Button
                variant="primary"
                onClick={() => backupNow.mutate()}
                loading={backupNow.isPending}
                loadingLabel="Backing up…"
              >
                Back up now
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-[var(--space-2)]">
            <p className="px-[var(--space-1)] text-[length:var(--text-sm)] tabular-nums text-[var(--color-text-muted)]">
              {files.length} {files.length === 1 ? "backup" : "backups"} ·{" "}
              {formatBytes(totalBytes(files))} total
            </p>

            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Date and time</TH>
                    <TH>Reason</TH>
                    <TH align="right">Size</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody className="[&>tr:last-child]:border-b-0">
                  {files.map((file) => (
                    <TR key={file.path}>
                      <TD primary>{formatDateTimeDisplay(file.at)}</TD>
                      <TD>
                        <Badge>{file.reason}</Badge>
                      </TD>
                      <TD align="right" muted>
                        {formatBytes(file.bytes)}
                      </TD>
                      <TD align="right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => setRestoreTarget(file)}
                        >
                          Restore
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>

            {backupsDir ? (
              <p
                title={backupsDir}
                className="truncate px-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
              >
                Stored in {backupsDir}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) setRestoreTarget(null);
        }}
        title="Restore this backup?"
        description={
          restoreTarget
            ? `Replace today's data (${formatDateDisplay(todayLocal())}) with the backup from ` +
              `${formatDateTimeDisplay(restoreTarget.at)}? Today's data will be backed up first, ` +
              `so this can be undone by restoring that backup afterward.`
            : undefined
        }
        confirmLabel="Restore"
        destructive
        onConfirm={async () => {
          if (!restoreTarget) return;
          try {
            await restoreMutation.mutateAsync(restoreTarget);
          } catch {
            // The mutation's onError already told the owner what happened;
            // rethrowing here would only surface as an unhandled rejection.
          }
          setRestoreTarget(null);
        }}
      />

      {isBusy ? (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed inset-0 z-40 flex flex-col items-center justify-center gap-[var(--space-4)]",
            "bg-[var(--color-bg)]",
          ].join(" ")}
        >
          <Spinner size={28} label="Restoring backup" />
          <div className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            Restoring your backup. This closes and reopens the database.
          </div>
        </div>
      ) : null}
    </div>
  );
}
