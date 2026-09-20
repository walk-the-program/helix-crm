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
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
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
import { switchWorkspace } from "@/app/boot";
import {
  adoptBackup,
  pickBackupFile,
  revealRecoveryKey,
  saveRecoveryKeyFile,
  suggestedName,
  type RevealedKey,
} from "@/features/data/backups/recovery";
import { todayLocal } from "@/lib/dates";
import { dqk } from "@/features/data/lib/queries";
import {
  backupCopyDir,
  copyOutIfConfigured,
  lastMirrorState,
  listBackups,
  restoreFromBackup,
  runBackup,
  setBackupCopyDir,
  type BackupFile,
} from "@/features/data/lib/backupsFs";
import { pickDirectory } from "@/features/data/lib/fsBridge";
import { formatBytes, totalBytes } from "@/features/data/lib/retention";
import { getBackupStatus, subscribeBackupStatus } from "@/features/data/backups/scheduler";
import { workspacePaths } from "@/features/data/lib/workspace";
import { useFormats } from "@/app/formats";

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

/**
 * Tauri rejects a command with a plain `{ code, message }` object rather than
 * an Error, so `String(err)` on the shape this screen sees most often gives
 * "[object Object]" (the same trap the lead poller fell into, F-LB-6).
 */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

/**
 * The recovery key panel.
 *
 * The key is fetched on a button press and dropped when the panel is closed:
 * nothing holds it across a navigation, and nothing renders it until the owner
 * has asked for it, so it cannot be read over a shoulder or caught in a
 * screen-share that happened to be on this screen.
 */
export function RecoveryKeyPanel() {
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const reveal = useMutation({
    mutationFn: () => revealRecoveryKey(),
    onSuccess: (key) => setRevealed(key),
    onError: (err: unknown) =>
      toast.error(
        messageFrom(err, "Helix could not read this workspace's recovery key."),
      ),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!revealed) return null;
      return saveRecoveryKeyFile(revealed);
    },
    onSuccess: (path) => {
      if (path === null) return; // the owner closed the dialog
      setSavedTo(path);
      toast.success("Recovery key saved.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not save the recovery key.")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery key</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-3)]">
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Your backups are encrypted with a key that is kept on this computer and
          nowhere else. If this computer is lost, stolen or replaced, that key is
          what lets you open a backup on the new one. Write it down now, while you
          still can.
        </p>

        {revealed === null ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => reveal.mutate()}
              loading={reveal.isPending}
              loadingLabel="Reading the key…"
            >
              Show recovery key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-3)]">
            <code
              data-testid="recovery-key"
              className={[
                "block select-all break-all",
                "border border-[var(--color-border-strong)]",
                "bg-[var(--color-bg)] px-[var(--space-3)] py-[var(--space-3)]",
                "font-[family-name:var(--font-mono)] text-[length:var(--text-sm)]",
                "leading-[var(--leading-normal)] tabular-nums text-[var(--color-text)]",
              ].join(" ")}
            >
              {revealed.key}
            </code>
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Keep it away from this computer and away from your backups. Anyone
              who has both can read everything in your CRM.
            </p>
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <Button
                variant="secondary"
                onClick={() => save.mutate()}
                loading={save.isPending}
                loadingLabel="Saving…"
              >
                Save to a file
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setRevealed(null);
                  setSavedTo(null);
                }}
              >
                Hide
              </Button>
            </div>
            {savedTo ? (
              <p
                title={savedTo}
                className="truncate text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
              >
                Saved to {savedTo}
              </p>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The second copy.
 *
 * Backups sit next to the live database, which covers a mistake and does not
 * cover a disk. One folder on a drive or in a synced folder is the difference,
 * and with the recovery key above it is the difference between "we can get your
 * data back" and "it is gone" (F-OPS-2).
 */
export function BackupCopyFolderPanel() {
  const queryClient = useQueryClient();
  const [mirror, setMirror] = useState(() => lastMirrorState());

  const dirQuery = useQuery({
    queryKey: dqk.backupCopyDir(),
    queryFn: () => backupCopyDir(),
  });
  const dir = dirQuery.data ?? null;

  const choose = useMutation({
    mutationFn: async () => {
      const picked = await pickDirectory({ title: "Choose a folder for a second copy" });
      if (picked === null) return null;
      await setBackupCopyDir(picked);
      await copyOutIfConfigured();
      return picked;
    },
    onSuccess: (picked) => {
      if (picked === null) return;
      void queryClient.invalidateQueries({ queryKey: dqk.backupCopyDir() });
      setMirror(lastMirrorState());
      toast.success("Second copy folder set.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not use that folder.")),
  });

  const copyNow = useMutation({
    mutationFn: () => copyOutIfConfigured(),
    onSuccess: () => {
      setMirror(lastMirrorState());
      toast.success("Backups copied.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not copy your backups.")),
  });

  const clear = useMutation({
    mutationFn: () => setBackupCopyDir(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dqk.backupCopyDir() });
      toast.success("Second copy turned off.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>A second copy</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-3)]">
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Backups live next to your data, on this computer. Choose a second
          folder - an external drive, or a folder your Dropbox, iCloud Drive or
          OneDrive already syncs - and Helix keeps a copy there after every
          backup. Nothing is uploaded by Helix, and the copies are encrypted the
          same way, so you will need your recovery key to open one elsewhere.
        </p>

        {dir ? (
          <>
            <p
              title={dir}
              className="truncate text-[length:var(--text-sm)] text-[var(--color-text)]"
            >
              {dir}
            </p>
            {mirror.error ? (
              <div
                role="alert"
                className={[
                  "flex items-start gap-[var(--space-3)]",
                  "border border-[var(--color-border)]",
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
                <div className="min-w-0">{mirror.error}</div>
              </div>
            ) : mirror.result ? (
              <p className="text-[length:var(--text-xs)] tabular-nums text-[var(--color-text-faint)]">
                {mirror.result.copied} copied, {mirror.result.removed} removed to match
                the 30 days Helix keeps.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <Button
                variant="secondary"
                onClick={() => copyNow.mutate()}
                loading={copyNow.isPending}
                loadingLabel="Copying…"
              >
                Copy now
              </Button>
              <Button
                variant="secondary"
                onClick={() => choose.mutate()}
                loading={choose.isPending}
                loadingLabel="Setting up…"
              >
                Change folder
              </Button>
              <Button variant="ghost" onClick={() => clear.mutate()}>
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button
              variant="secondary"
              onClick={() => choose.mutate()}
              loading={choose.isPending}
              loadingLabel="Setting up…"
            >
              Choose a folder
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Opening a backup that came from somewhere else.
 *
 * This is the other half of the recovery key and the reason it exists: a
 * machine with an empty keychain, a backup file, and the key off a piece of
 * paper. Rust does the whole risky half and leaves nothing behind if the key is
 * wrong (`src-tauri/src/recovery.rs`).
 */
export function OpenFromAnotherMachinePanel() {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const choose = useMutation({
    mutationFn: () => pickBackupFile(),
    onSuccess: (path) => {
      if (path === null) return;
      setSourcePath(path);
      setError(null);
      if (name.trim().length === 0) setName(suggestedName(path));
    },
    onError: (err: unknown) =>
      setError(messageFrom(err, "Helix could not open the file chooser.")),
  });

  const open = useMutation({
    mutationFn: async () => {
      if (!sourcePath) throw new Error("Choose a backup file first.");
      const entry = await adoptBackup(sourcePath, key, name);
      await switchWorkspace(entry);
      return entry;
    },
    onSuccess: (entry) => {
      setSourcePath(null);
      setKey("");
      setName("");
      setError(null);
      toast.success(`Opened ${entry.name}.`);
    },
    onError: (err: unknown) =>
      setError(
        messageFrom(err, "Helix could not open that backup with that key."),
      ),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a backup from another machine</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Moving to a new computer, or recovering from one you have lost. Choose a
          backup file and type the recovery key from the old computer. Helix adds
          it as a second workspace and leaves everything here as it is.
        </p>

        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <Button
            variant="secondary"
            onClick={() => choose.mutate()}
            disabled={open.isPending}
          >
            Choose a backup file
          </Button>
          {sourcePath ? (
            <span
              title={sourcePath}
              className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            >
              {sourcePath}
            </span>
          ) : null}
        </div>

        <Field
          label="Recovery key"
          hint="The key from the computer this backup came from. Dashes and spaces do not matter."
        >
          <Input
            value={key}
            spellCheck={false}
            autoComplete="off"
            placeholder="HLX1-0000-0000-0000-0000-0000-0000-0000-0000"
            onChange={(e) => setKey(e.target.value)}
            disabled={open.isPending}
          />
        </Field>

        <Field label="Name this workspace">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Restored workspace"
            disabled={open.isPending}
          />
        </Field>

        {error ? (
          <div
            role="alert"
            className={[
              "flex items-start gap-[var(--space-3)]",
              "border border-[var(--color-border)]",
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
            <div className="min-w-0">{error}</div>
          </div>
        ) : null}

        <div>
          <Button
            variant="secondary"
            disabled={sourcePath === null || key.trim().length === 0}
            loading={open.isPending}
            loadingLabel="Opening…"
            onClick={() => open.mutate()}
          >
            Open this backup
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function BackupsScreen() {
  const formats = useFormats();
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
          // One primary block per screen: while the list is empty the empty
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
              "border border-[var(--color-border)]",
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

        {backupsQuery.isLoading ? (
          <div className="flex justify-center py-[var(--space-10)]">
            <Spinner label="Loading backups" />
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            title="No backups yet"
            description="The first one is written the next time you open Helix, or start one now."
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
                <TBody>
                  {files.map((file) => (
                    <TR key={file.path}>
                      <TD primary>{formats.dateTime(file.at)}</TD>
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
            <p className="px-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
              Each backup is a copy of your database, encrypted the same way the open
              file is. It does not include the files you have attached to a contact,
              company or job - those live in a separate, unencrypted folder next to it.
            </p>
          </div>
        )}

        <BackupCopyFolderPanel />
        <RecoveryKeyPanel />
        <OpenFromAnotherMachinePanel />
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) setRestoreTarget(null);
        }}
        title="Restore this backup?"
        description={
          restoreTarget
            ? `Replace today's data (${formats.date(todayLocal())}) with the backup from ` +
              `${formats.dateTime(restoreTarget.at)}? Today's data will be backed up first, ` +
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
