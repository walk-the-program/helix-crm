/**
 * Diagnostics: where the data is, how big it is, and what the app last did.
 *
 * Nothing here is an action on the owner's data. Two buttons: copy the log, and
 * show me the folder. Both say plainly when they cannot work rather than
 * failing silently, which is the whole point of the screen.
 */
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, FolderOpen } from "lucide-react";
import { Badge, Button, toast } from "@/ui";
import { useWriteState } from "@/app/hooks";
import { formatDateTimeDisplay } from "@/lib/dates";
import {
  SettingsScreenFrame,
  SettingsBlock,
  DataRow,
} from "@/features/settings/components/SettingsLayout";
import { settingsKeys } from "@/features/settings/lib/queries";
import {
  copyLog,
  formatBytes,
  readDiagnostics,
  revealDataFolder,
} from "@/features/settings/lib/diagnostics";

function Unknown(props: { children?: string }) {
  return (
    <span className="text-[var(--color-text-faint)]">
      {props.children ?? "Not known yet"}
    </span>
  );
}

function Mono(props: { children: string }) {
  return (
    <span className="font-[var(--font-mono)] text-[length:var(--text-sm)] break-all">
      {props.children}
    </span>
  );
}

export function DiagnosticsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: settingsKeys.diagnostics(),
    queryFn: readDiagnostics,
    staleTime: 0,
  });
  const write = useWriteState();

  async function onCopyLog() {
    const result = await copyLog();
    if (result.ok) toast.success("Copied the log to the clipboard");
    else toast.error(result.reason);
  }

  async function onReveal() {
    const folder = data?.db?.path
      ? data.db.path.replace(/[/\\][^/\\]+$/, "")
      : data?.appData ?? null;
    const result = await revealDataFolder(folder);
    if (!result.ok) toast.error(result.reason);
  }

  return (
    <SettingsScreenFrame
      title="Diagnostics"
      subtitle="Where your data lives and what Helix last did with it."
      testId="settings-diagnostics"
      actions={
        <div className="flex items-center gap-[var(--space-2)]">
          <Button
            variant="secondary"
            iconLeft={<ClipboardCopy size={16} aria-hidden />}
            onClick={() => void onCopyLog()}
            data-testid="diagnostics-copy-log"
          >
            Copy log
          </Button>
          <Button
            variant="secondary"
            iconLeft={<FolderOpen size={16} aria-hidden />}
            onClick={() => void onReveal()}
            data-testid="diagnostics-reveal"
          >
            Reveal data folder
          </Button>
        </div>
      }
    >
      {isLoading || !data ? (
        <p
          className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          role="status"
        >
          Reading the database and the workspace file…
        </p>
      ) : (
        <>
          <SettingsBlock title="This copy of Helix">
            <DataRow label="Version">{data.appVersion}</DataRow>
            <DataRow label="Workspace">
              {data.workspaceName ?? <Unknown />}
            </DataRow>
            <DataRow label="Write queue">
              {write.busy ? (
                <span>
                  {write.label ?? "A write is running"}
                  {write.queued > 0 ? ` · ${write.queued} waiting` : ""}
                </span>
              ) : (
                "Idle"
              )}
            </DataRow>
            <DataRow label="Key storage">
              {data.keychain ? (
                <Badge tone="success">Keychain available</Badge>
              ) : (
                <Badge tone="warning">No keychain on this machine</Badge>
              )}
            </DataRow>
          </SettingsBlock>

          <SettingsBlock title="Database">
            <DataRow label="File">
              {data.db?.path ? <Mono>{data.db.path}</Mono> : <Unknown />}
            </DataRow>
            <DataRow label="Size">
              {data.db ? (
                <span className="tabular">{formatBytes(data.db.sizeBytes)}</span>
              ) : (
                <Unknown>{data.dbError ?? "Not known yet"}</Unknown>
              )}
            </DataRow>
            <DataRow label="SQLite">
              {data.db?.sqliteVersion ?? <Unknown />}
            </DataRow>
            <DataRow label="Search (FTS5)">
              {data.db ? (
                data.db.fts5 ? (
                  <Badge tone="success">Working</Badge>
                ) : (
                  <Badge tone="danger">Missing from this build</Badge>
                )
              ) : (
                <Unknown />
              )}
            </DataRow>
            <DataRow label="Migration">
              {data.migration ? (
                <span>
                  {data.migration.version}{" "}
                  <span className="text-[var(--color-text-muted)]">
                    ({data.migration.count} applied,{" "}
                    {formatDateTimeDisplay(data.migration.appliedAt)})
                  </span>
                </span>
              ) : (
                <Unknown />
              )}
            </DataRow>
            <DataRow label="Last backup">
              {data.lastBackupAt ? (
                formatDateTimeDisplay(data.lastBackupAt)
              ) : (
                <Unknown>No backup has run yet</Unknown>
              )}
            </DataRow>
          </SettingsBlock>

          <SettingsBlock title="Website leads">
            <DataRow label="Site">
              {data.siteOrigin ? <Mono>{data.siteOrigin}</Mono> : <Unknown>No site connected</Unknown>}
            </DataRow>
            <DataRow label="Last checked">
              {data.lastPolledAt ? (
                formatDateTimeDisplay(data.lastPolledAt)
              ) : (
                <Unknown>Never</Unknown>
              )}
            </DataRow>
            <DataRow label="Last error">
              {data.lastPollError ? (
                <span className="text-[var(--color-danger-ink)]">{data.lastPollError}</span>
              ) : (
                "None"
              )}
            </DataRow>
          </SettingsBlock>

          <SettingsBlock
            title="Files"
            description="Backups and attachments sit beside the database in this folder."
          >
            <DataRow label="App data">
              {data.appData ? <Mono>{data.appData}</Mono> : <Unknown />}
            </DataRow>
            <DataRow label="Log file">
              {data.logPath ? <Mono>{data.logPath}</Mono> : <Unknown />}
            </DataRow>
          </SettingsBlock>
        </>
      )}
    </SettingsScreenFrame>
  );
}
