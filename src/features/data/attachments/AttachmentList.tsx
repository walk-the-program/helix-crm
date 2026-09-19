/**
 * Files on a record. Built here so the records feature can drop it onto a
 * contact, a company or a deal page without rebuilding the Rust round trip.
 *
 *   add:    dialog -> copy_in(src) -> attachments.create(row)
 *   list:   attachments.list(entityType, entityId)
 *   thumb:  convertFileSrc(<workspace>/attachments/<storedName>)  (asset://)
 *   open:   plugin-opener openPath
 *   remove: soft delete, with a 10-second Undo
 *
 * JS never chooses where the file lands: `copy_in` picks the destination in
 * Rust and answers with the stored name (docs/CONTRACTS.md). Anything over
 * 50 MB is refused, and the refusal is shown inline rather than as a toast,
 * because the owner is looking at the list when it happens.
 *
 * API and usage: see src/features/data/attachments/README.md.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2 } from "@/ui/icons";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardRow,
  CardTitle,
  EmptyState,
  Spinner,
  toast,
} from "@/ui";
import { formatDateDisplay } from "@/lib/dates";
import {
  AttachmentTooLargeError,
  MAX_ATTACHMENT_BYTES,
  create as createAttachment,
  list as listAttachments,
  restore as restoreAttachment,
  softDelete as removeAttachment,
  type Attachment,
} from "@/db/repos/attachments";
import { dqk } from "@/features/data/lib/queries";
import {
  assetUrl,
  basenameOf,
  joinPath,
  openWithOs,
  pickOpenFile,
} from "@/features/data/lib/fsBridge";
import { workspacePaths } from "@/features/data/lib/workspace";

const UNDO_MS = 10_000;

export type CopiedFile = { storedName: string; bytes: number; mime: string };

/** The Rust side of "add a file": it chooses the destination, we never do. */
export async function copyFileIntoWorkspace(src: string): Promise<CopiedFile> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CopiedFile>("copy_in", { src });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function Thumbnail(props: { attachment: Attachment; dir: string | null }) {
  const { attachment, dir } = props;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!dir || !isImage(attachment.mime)) return;
    void assetUrl(joinPath(dir, attachment.storedName)).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [dir, attachment.storedName, attachment.mime]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-[var(--space-8)] w-[var(--space-8)] shrink-0 border border-[var(--color-border)] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-[var(--space-8)] w-[var(--space-8)] shrink-0 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-faint)]"
    >
      <FileText size={18} weight="regular" aria-hidden="true" />
    </span>
  );
}

export function AttachmentList(props: {
  entityType: string;
  entityId: string;
  /** Hide the heading when the host screen already has one. */
  compact?: boolean;
}) {
  const { entityType, entityId, compact } = props;
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void workspacePaths()
      .then((paths) => {
        if (live) setDir(paths.attachmentsDir);
      })
      .catch(() => {
        if (live) setDir(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const files = useQuery({
    queryKey: dqk.attachments(entityType, entityId),
    queryFn: () => listAttachments(entityType, entityId),
  });

  async function add() {
    setProblem(null);
    setAdding(true);
    try {
      const src = await pickOpenFile({ title: "Choose a file to attach" });
      if (src === null) return;
      const copied = await copyFileIntoWorkspace(src);
      await createAttachment({
        entityType,
        entityId,
        fileName: basenameOf(src),
        storedName: copied.storedName,
        bytes: copied.bytes,
        mime: copied.mime,
      });
      await queryClient.invalidateQueries({
        queryKey: dqk.attachments(entityType, entityId),
      });
    } catch (err) {
      if (err instanceof AttachmentTooLargeError) {
        setProblem(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      // Rust refuses an oversized file before JS ever sees the bytes.
      setProblem(
        /50 ?MB|too large/i.test(message)
          ? `That file is bigger than the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit.`
          : `Helix could not attach that file. ${message}`,
      );
    } finally {
      setAdding(false);
    }
  }

  async function open(attachment: Attachment) {
    if (!dir) return;
    try {
      await openWithOs(joinPath(dir, attachment.storedName));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Your computer could not open that file.",
      );
    }
  }

  async function remove(attachment: Attachment) {
    await removeAttachment(attachment.id);
    await queryClient.invalidateQueries({
      queryKey: dqk.attachments(entityType, entityId),
    });
    toast.undo(
      `Removed ${attachment.fileName}.`,
      () => {
        void (async () => {
          await restoreAttachment(attachment.id);
          await queryClient.invalidateQueries({
            queryKey: dqk.attachments(entityType, entityId),
          });
        })();
      },
      { duration: UNDO_MS },
    );
  }

  const rows = files.data ?? [];

  return (
    <Card>
      {compact ? null : (
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void add()}
            loading={adding}
            iconLeft={<Paperclip size={16} weight="bold" aria-hidden="true" />}
          >
            Add a file
          </Button>
        </CardHeader>
      )}

      {problem ? (
        <CardBody className="pb-0">
          <p
            role="alert"
            className="bg-[var(--color-danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-danger-ink)]"
          >
            {problem}
          </p>
        </CardBody>
      ) : null}

      {files.isLoading ? (
        <CardBody>
          <div className="flex items-center gap-[var(--space-2)] text-[var(--color-text-muted)]">
            <Spinner size={16} /> Reading the files…
          </div>
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody>
          <EmptyState
            // The default --space-10 padding is right for a whole pane and
            // makes a 300px box out of one sentence inside a 380px details
            // column (docs/STATUS.md, records sweep, contract item 3).
            className="py-[var(--space-5)]"
            title="No files yet"
            description="Quotes, photos of the job, a signed estimate: anything you would otherwise dig out of email."
            action={
              compact ? (
                <Button variant="secondary" size="sm" onClick={() => void add()} loading={adding}>
                  Add a file
                </Button>
              ) : undefined
            }
          />
        </CardBody>
      ) : (
        <ul className="flex flex-col">
          {rows.map((attachment) => (
            <li
              key={attachment.id}
              className="border-b border-[var(--color-border)] last:border-b-0"
            >
              <CardRow className="border-b-0">
                <Thumbnail attachment={attachment} dir={dir} />
                <button
                  type="button"
                  onClick={() => void open(attachment)}
                  className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2"
                >
                  <span className="truncate font-medium text-[var(--color-text)]">
                    {attachment.fileName}
                  </span>
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--color-text-faint)]">
                    {formatFileSize(attachment.bytes)} · added{" "}
                    {formatDateDisplay(attachment.createdAt)}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={() => void remove(attachment)}
                  iconLeft={<Trash2 size={16} weight="bold" aria-hidden="true" />}
                >
                  Remove
                </Button>
              </CardRow>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
