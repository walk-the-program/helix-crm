/**
 * The full-screen states from docs/PLAN.md's error map: the database would not
 * open, this build has no FTS5, a migration failed, and the top-level error
 * boundary. Each one names the problem in plain words, shows the path, and
 * never swallows the detail.
 */
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, CaretRight, DatabaseZap, HardDriveDownload } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { MigrationError } from "@/db/migrator";
import { DbOpenError, Fts5MissingError } from "@/db/client";
import { Brand, Button, Card, CardBody, Spinner } from "@/ui";

function FullScreen({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-[var(--space-7)] bg-[var(--color-bg)] p-[var(--space-8)] text-[var(--color-text)]">
      {/* The lockup sits above the message: a boot screen is the first thing
          the owner sees when something has gone wrong, and the brand saying
          who is talking is worth more there than on any other screen. */}
      <Brand size="lg" />
      <Card className="w-full max-w-[560px]">
        <CardBody className="p-[var(--space-6)]">
          <div className="flex items-start gap-[var(--space-4)]">
            <div className="flex-none text-[var(--color-danger-ink)]">{icon}</div>
            <div className="min-w-0 flex-1">
              <h1 className="m-0 font-[family-name:var(--font-heading)] text-[length:var(--text-subhead)] font-bold leading-[var(--leading-subhead)] tracking-[var(--tracking-title)] text-[var(--color-heading)]">
                {title}
              </h1>
              <div className="mt-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
                {children}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * "Show the workspace folder", the one escape a boot screen can actually
 * offer (F-LC-10).
 *
 * Before this, every boot failure had exactly one control — "Try again" — on
 * a screen that had just failed, so an owner whose file would not open had
 * nowhere to go but press it again. Opening the folder is the thing he needs:
 * it is where the backups are, it is what he would attach to an email, and it
 * is the one action that needs no database.
 *
 * The opener plugin is imported where it is used rather than at module load,
 * so a browser build (the e2e harness) can render these screens without a
 * Tauri runtime. A failure to open the folder is swallowed on purpose: this is
 * the error screen, and an error inside it helps nobody.
 */
function ShowFolderButton({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={() => {
        setBusy(true);
        void (async () => {
          try {
            const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
            await revealItemInDir(path);
          } catch {
            /* Nothing useful to say here, on this of all screens. */
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      Show the workspace folder
    </Button>
  );
}

/** The row of escapes under a boot failure. */
function Actions({ path, onRetry }: { path?: string; onRetry?: () => void }) {
  if (!onRetry && !path) return null;
  return (
    <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
      {onRetry ? (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {path ? <ShowFolderButton path={path} /> : null}
    </div>
  );
}

/**
 * The workspace's path: short, human-readable, and the thing the owner
 * actually needs on this screen, so it stays in the open. Monospace because a
 * path is a path, but at caption size and in faint ink — it is evidence, not
 * the message.
 */
function PathLine({ path }: { path: string }) {
  return (
    <p className="mt-[var(--space-3)] break-all font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
      {path}
    </p>
  );
}

/**
 * The raw error, folded away.
 *
 * It used to sit open on every boot screen: a 220px block of JavaScript, in
 * monospace, immediately under a sentence written for a landscaper. It is the
 * loudest thing on the screen and it is the one part he cannot read. So it
 * goes behind a disclosure — still one click away, still never swallowed,
 * still selectable — with a button that puts it on the clipboard, because
 * every one of these screens asks him to send it to somebody and none of them
 * used to give him a way to pick it up.
 *
 * `<details>` is the right control here and not a state hook: it is keyboard
 * operable, it is announced as a disclosure, and its contents stay in the DOM
 * (and in the accessibility tree's text) while it is closed.
 */
function Detail({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = typeof children === "string" ? children : String(children ?? "");

  return (
    <details className="group mt-[var(--space-4)]">
      <summary
        className={cn(
          "inline-flex cursor-default list-none items-center gap-[var(--space-2)]",
          "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
          "hover:text-[var(--color-text)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <CaretRight
          size={14}
          weight="bold"
          aria-hidden="true"
          className="flex-none transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        Details
      </summary>
      <pre className="mt-[var(--space-2)] max-h-[220px] overflow-auto whitespace-pre-wrap bg-[var(--color-accent-soft)] p-[var(--space-3)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
        {children}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        className="mt-[var(--space-2)]"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            // The clipboard can be refused. The text is on screen and
            // selectable either way, so say nothing and leave the label alone.
            .catch(() => {});
        }}
      >
        {copied ? "Copied" : "Copy the details"}
      </Button>
    </details>
  );
}

export function BootingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-[var(--space-7)] bg-[var(--color-bg)] text-[var(--color-text-muted)]">
      <Brand size="lg" />
      <Spinner size={24} label="Opening your data" />
    </div>
  );
}

export function DbOpenErrorScreen({
  error,
  path,
  onRetry,
}: {
  error: DbOpenError;
  path?: string;
  onRetry?: () => void;
}) {
  return (
    <FullScreen icon={<DatabaseZap size={28} weight="regular" />} title="Helix can't open your data">
      <p className="m-0">
        The workspace file could not be opened. Another copy of Helix may have
        it, or the folder may not be writable.
      </p>
      {path ? <PathLine path={path} /> : null}
      <Detail>{error.message}</Detail>
      <Actions path={path} onRetry={onRetry} />
    </FullScreen>
  );
}

export function Fts5MissingScreen({ error }: { error: Fts5MissingError }) {
  return (
    <FullScreen icon={<AlertTriangle size={28} weight="regular" />} title="This build is missing search">
      <p className="m-0">
        Helix was built against a copy of SQLite without FTS5, so search cannot
        work. Download Helix again from wherever you got it — this copy is
        broken and no setting will fix it.
      </p>
      <Detail>{error.message}</Detail>
    </FullScreen>
  );
}

export function MigrationErrorScreen({ error }: { error: MigrationError }) {
  return (
    <FullScreen
      icon={<HardDriveDownload size={28} weight="regular" />}
      title="This update could not finish"
    >
      <p className="m-0">
        Nothing was changed: the update was rolled back.
        {error.backupPath
          ? " Your data was backed up first, and that backup is untouched."
          : ""}{" "}
        Install the previous version to keep working, and send us the detail
        below.
      </p>
      {error.backupPath ? <PathLine path={error.backupPath} /> : null}
      <Detail>
        {error.tag}
        {"\n"}
        {error.message}
      </Detail>
    </FullScreen>
  );
}

/** Whatever else went wrong at boot. */
export function BootErrorScreen({
  error,
  path,
  onRetry,
}: {
  error: unknown;
  path?: string;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <FullScreen icon={<AlertTriangle size={28} weight="regular" />} title="Helix could not start">
      <p className="m-0">Something failed before the first screen could load.</p>
      <Detail>{message}</Detail>
      <Actions path={path} onRetry={onRetry} />
    </FullScreen>
  );
}

/** Pick the right full-screen state for a boot failure. */
export function BootFailure({
  error,
  path,
  onRetry,
}: {
  error: unknown;
  path?: string;
  onRetry?: () => void;
}) {
  if (error instanceof Fts5MissingError) return <Fts5MissingScreen error={error} />;
  if (error instanceof DbOpenError)
    return <DbOpenErrorScreen error={error} path={path} onRetry={onRetry} />;
  if (error instanceof MigrationError) return <MigrationErrorScreen error={error} />;
  return <BootErrorScreen error={error} path={path} onRetry={onRetry} />;
}

/* -------------------------------------------------------------------------- */
/* the one top-level error boundary                                           */
/* -------------------------------------------------------------------------- */

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null; stack: string | null };

/**
 * A single top-level boundary: it shows what broke and never swallows it.
 * Services have no catch-all handlers, by design.
 */
export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null, stack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[helix] unhandled error", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private reset = () => {
    this.setState({ error: null, stack: null });
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <FullScreen icon={<AlertTriangle size={28} weight="regular" />} title="Something broke">
        <p className="m-0">
          Helix hit an error it did not expect. Your data is untouched. Go back
          to the app and carry on; if it keeps happening, copy the details and
          send them to us. Read them first - an error can quote a name, an
          address or a note from your own records.
        </p>
        <Detail>
          {error.message}
          {stack ? `\n${stack}` : ""}
        </Detail>
        <div className="mt-[var(--space-4)] flex gap-[var(--space-3)]">
          <Button variant="primary" onClick={this.reset}>
            Back to the app
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload Helix
          </Button>
        </div>
      </FullScreen>
    );
  }
}
