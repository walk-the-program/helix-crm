/**
 * Diagnostics: where the data is, how big it is, and what the app last did.
 *
 * Four grouped inset lists of label/value rows and nothing else — this screen
 * reads, it never writes. Both buttons are quiet (ghost), so the screen shows
 * no primary at all: a screen earns its one block of brand primary only when
 * it has a single thing the owner came to do, and this one has two equals.
 *
 * Both say plainly when they cannot work rather than failing silently, which is
 * the whole point of the screen.
 */
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, FolderOpen, ICON_SIZE_SM, ICON_WEIGHT_STRONG } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { useWriteState } from "@/app/hooks";
import { formatDateTimeDisplay } from "@/lib/dates";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsScreenFrame,
  SettingsValueRow,
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

/** A path or a version string: the one place the product sets a monospace. */
function Mono(props: { children: string }) {
  return (
    <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] break-all">
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
        <div className="flex items-center gap-[var(--space-1)]">
          <Button
            variant="ghost"
            iconLeft={
              <ClipboardCopy size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
            }
            onClick={() => void onCopyLog()}
            data-testid="diagnostics-copy-log"
          >
            Copy log
          </Button>
          <Button
            variant="ghost"
            iconLeft={<FolderOpen size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
            onClick={() => void onReveal()}
            data-testid="diagnostics-reveal"
          >
            Reveal data folder
          </Button>
        </div>
      }
    >
      {isLoading || !data ? (
        <SettingsLoading>Reading the database and the workspace file…</SettingsLoading>
      ) : (
        <>
          <SettingsGroup label="This copy of Helix">
            <SettingsValueRow label="Version">{data.appVersion}</SettingsValueRow>
            <SettingsValueRow label="Workspace">
              {data.workspaceName ?? <Unknown />}
            </SettingsValueRow>
            <SettingsValueRow label="Write queue">
              {write.busy ? (
                <span>
                  {write.label ?? "A write is running"}
                  {write.queued > 0 ? ` · ${write.queued} waiting` : ""}
                </span>
              ) : (
                "Idle"
              )}
            </SettingsValueRow>
            <SettingsValueRow label="Key storage">
              {data.keychain ? (
                <Badge tone="success">Keychain available</Badge>
              ) : (
                <Badge tone="warning">No keychain on this machine</Badge>
              )}
            </SettingsValueRow>
          </SettingsGroup>

          <SettingsGroup label="Database">
            <SettingsValueRow label="File">
              {data.db?.path ? <Mono>{data.db.path}</Mono> : <Unknown />}
            </SettingsValueRow>
            <SettingsValueRow label="Size">
              {data.db ? (
                <span className="tabular">{formatBytes(data.db.sizeBytes)}</span>
              ) : (
                <Unknown>{data.dbError ?? "Not known yet"}</Unknown>
              )}
            </SettingsValueRow>
            <SettingsValueRow label="SQLite">
              {data.db?.sqliteVersion ?? <Unknown />}
            </SettingsValueRow>
            <SettingsValueRow label="Search (FTS5)">
              {data.db ? (
                data.db.fts5 ? (
                  <Badge tone="success">Working</Badge>
                ) : (
                  <Badge tone="danger">Missing from this build</Badge>
                )
              ) : (
                <Unknown />
              )}
            </SettingsValueRow>
            <SettingsValueRow label="Migration">
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
            </SettingsValueRow>
            <SettingsValueRow label="Last backup">
              {data.lastBackupAt ? (
                formatDateTimeDisplay(data.lastBackupAt)
              ) : (
                <Unknown>No backup has run yet</Unknown>
              )}
            </SettingsValueRow>
          </SettingsGroup>

          <SettingsGroup label="Website leads">
            <SettingsValueRow label="Site">
              {data.siteOrigin ? (
                <Mono>{data.siteOrigin}</Mono>
              ) : (
                <Unknown>No site connected</Unknown>
              )}
            </SettingsValueRow>
            <SettingsValueRow label="Last checked">
              {data.lastPolledAt ? (
                formatDateTimeDisplay(data.lastPolledAt)
              ) : (
                <Unknown>Never</Unknown>
              )}
            </SettingsValueRow>
            <SettingsValueRow label="Last error">
              {data.lastPollError ? (
                <span className="text-[var(--color-danger-ink)]">{data.lastPollError}</span>
              ) : (
                "None"
              )}
            </SettingsValueRow>
          </SettingsGroup>

          <SettingsGroup
            label="Files"
            footnote="Backups and attachments sit beside the database in this folder."
          >
            <SettingsValueRow label="App data">
              {data.appData ? <Mono>{data.appData}</Mono> : <Unknown />}
            </SettingsValueRow>
            <SettingsValueRow label="Log file">
              {data.logPath ? <Mono>{data.logPath}</Mono> : <Unknown />}
            </SettingsValueRow>
          </SettingsGroup>
        </>
      )}
    </SettingsScreenFrame>
  );
}
