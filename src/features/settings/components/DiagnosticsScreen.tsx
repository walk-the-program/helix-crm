/**
 * Diagnostics: where the data is, how big it is, and what the app last did.
 *
 * Five grouped inset lists of label/value rows and nothing else — this screen
 * reads, it never writes. Both buttons are quiet (ghost), so the screen shows
 * no primary at all: a screen earns its one block of brand primary only when
 * it has a single thing the owner came to do, and this one has two equals.
 *
 * Both say plainly when they cannot work rather than failing silently, which is
 * the whole point of the screen.
 *
 * The Encryption group is the one place in the product that answers "is my
 * customer list safe on this laptop". It is two readings and they are different
 * things: the workspace file is encrypted by Helix (SQLCipher, keyed from the
 * OS keychain), and the disk under it is encrypted by the OS (FileVault or
 * BitLocker) or it is not. Neither reading is ever guessed. `db_info()` leaves
 * both of its fields out when the build cannot tell - which is the case under
 * the e2e harness and in the unit tests, both plain better-sqlite3 - and that
 * reads as "Unknown", never as "Not encrypted". The disk check answers
 * `encrypted: null` when it could not run, which is also not "off".
 */
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, FolderOpen, ICON_SIZE_SM, ICON_WEIGHT_STRONG } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { useWriteState } from "@/app/hooks";
import { useFormats } from "@/app/formats";
import { isTauri } from "@/app/appSettings";
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
  type DiskEncryption,
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

/**
 * Whether Helix encrypted its own file, in one sentence.
 *
 * `encrypted` being absent is the normal case outside the desktop build and
 * means "this build cannot tell". Saying "Not encrypted" there would be a lie
 * about the owner's data, so it says Unknown.
 */
function WorkspaceEncryption(props: {
  encrypted: boolean | undefined;
  cipherVersion: string | undefined;
  unavailable: boolean;
}) {
  if (props.unavailable) return <Unknown />;
  if (props.encrypted === undefined) return <Unknown>Unknown</Unknown>;
  if (props.encrypted === false) {
    return (
      <span className="text-[var(--color-danger-ink)]">
        This file is not encrypted.
      </span>
    );
  }
  return (
    <span>
      Your workspace file is encrypted on this computer.
      {props.cipherVersion ? (
        <span className="text-[var(--color-text-muted)]">
          {" "}
          SQLCipher {props.cipherVersion}.
        </span>
      ) : null}
    </span>
  );
}

/** What the OS calls its own full-disk encryption, so the row names the switch. */
function diskEncryptionName(platform: string): string {
  if (platform === "macos") return "FileVault";
  if (platform === "windows") return "BitLocker";
  return "Full-disk encryption";
}

/** The one sentence that says where to turn it on, per platform. */
function howToTurnItOn(platform: string): string {
  if (platform === "macos") {
    return "Turn it on in System Settings, under Privacy and Security.";
  }
  if (platform === "windows") {
    return "Turn it on in Settings, under Privacy and security, Device encryption.";
  }
  return "Turn it on in your operating system's security settings.";
}

function DiskEncryptionValue(props: { status: DiskEncryption | null }) {
  const { status } = props;
  if (!status) return <Unknown>Could not check</Unknown>;

  const name = diskEncryptionName(status.platform);

  if (status.encrypted === true) {
    return <span>{status.detail || `${name} is on.`}</span>;
  }

  if (status.encrypted === false) {
    return (
      <span className="flex flex-col gap-[var(--space-1)]">
        <span>{status.detail || `${name} is off.`}</span>
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {howToTurnItOn(status.platform)}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-[var(--space-1)]">
      <Unknown>Could not check</Unknown>
      {status.detail ? (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {status.detail}
        </span>
      ) : null}
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
  const formats = useFormats();

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
            {/* F-LC-15: `keychainAvailable()` reads "the call did not
                throw" as "the keychain is present", which is only reliable
                inside a real desktop build. Outside Tauri — the e2e harness
                and every unit test, both plain better-sqlite3 with no Rust
                side at all — the call always throws and always resolves to
                `false`, which used to render as the definitive "No keychain
                on this machine" instead of "cannot tell", unlike
                `WorkspaceEncryption` and `DiskEncryptionValue` above, which
                already say Unknown in exactly that situation. `isTauri()` is
                the same environment check those two are built on. */}
            <SettingsValueRow label="Key storage">
              {!isTauri() ? (
                <Unknown>Unknown</Unknown>
              ) : data.keychain ? (
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
                    {formats.dateTime(data.migration.appliedAt)})
                  </span>
                </span>
              ) : (
                <Unknown />
              )}
            </SettingsValueRow>
            <SettingsValueRow label="Last backup">
              {data.lastBackupAt ? (
                formats.dateTime(data.lastBackupAt)
              ) : (
                <Unknown>No backup has run yet</Unknown>
              )}
            </SettingsValueRow>
          </SettingsGroup>

          <SettingsGroup
            label="Encryption"
            footnote="Helix encrypts its own file. Full-disk encryption is the operating system's job, and it covers everything else on the machine."
          >
            <SettingsValueRow label="Workspace file">
              <WorkspaceEncryption
                encrypted={data.db?.encrypted}
                cipherVersion={data.db?.cipherVersion}
                unavailable={data.db === null}
              />
            </SettingsValueRow>
            <SettingsValueRow label="Disk encryption">
              <DiskEncryptionValue status={data.diskEncryption} />
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
                formats.dateTime(data.lastPolledAt)
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
