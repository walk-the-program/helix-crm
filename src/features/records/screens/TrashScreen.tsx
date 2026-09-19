/**
 * "/trash" - everything soft-deleted, per type, with restore and permanent
 * delete (docs/PLAN.md item 18).
 *
 * All data access goes through src/db/repos/trash.ts. This screen never
 * writes SQL: it reads trash.counts()/trash.list(type) through TanStack
 * Query and calls trash.restore()/trash.purge() on write, invalidating the
 * shared `records` keys afterward so every other screen's cache catches up.
 *
 * "Empty the trash" purges a whole type sequentially - one `await` per row,
 * never Promise.all - because the write lock serialises every caller and a
 * parallel storm would just queue behind itself for no benefit.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from "@/ui";
import { qk } from "@/app/queryClient";
import { useVocabulary } from "@/app/vocabulary";
import * as trash from "@/db/repos/trash";
import type { TrashEntityType, TrashItem } from "@/db/repos/trash";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";
import {
  addDaysToDateString,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatRelative,
  todayLocal,
  toLocalDateString,
} from "@/lib/dates";

/** Order matches src/db/repos/trash.ts TABLES, and docs/PLAN.md's human labels. */
const TYPES: TrashEntityType[] = [
  "contact",
  "company",
  "deal",
  "activity",
  "task",
  "tag",
  "saved_view",
  "attachment",
];

const TYPE_LABELS: Record<TrashEntityType, string> = {
  contact: "Contacts",
  company: "Companies",
  deal: "Deals",
  activity: "Timeline entries",
  task: "Tasks",
  tag: "Tags",
  saved_view: "Saved views",
  attachment: "Attachments",
};

const TYPE_LOWER_PLURAL: Record<TrashEntityType, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  activity: "timeline entries",
  task: "tasks",
  tag: "tags",
  saved_view: "saved views",
  attachment: "attachments",
};

export function TrashScreen(): ReactElement {
  const vocabulary = useVocabulary();
  const countsQuery = useQuery({
    queryKey: qk.trash(),
    queryFn: () => trash.counts(),
  });
  const counts = countsQuery.data;
  const totalCount = counts ? TYPES.reduce((sum, type) => sum + counts[type], 0) : null;
  const [activeType, setActiveType] = useState<TrashEntityType>(TYPES[0]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Trash"
        subtitle="Deleted records stay here for 30 days, then Helix removes them for good."
      />
      <div className="flex-1 overflow-auto py-[var(--space-4)]">
        {totalCount === 0 ? (
          <EmptyState
            icon={<Trash2 size={24} aria-hidden="true" />}
            title="Trash is empty"
            description="Nothing has been deleted in the last 30 days."
            action={
              <Link
                href="/contacts"
                className={[
                  "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
                  "underline-offset-2 hover:underline",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                ].join(" ")}
              >
                Back to Contacts
              </Link>
            }
          />
        ) : totalCount === null ? null : (
          <Tabs value={activeType} onValueChange={(value) => setActiveType(value as TrashEntityType)}>
            <TabsList>
              {TYPES.map((type) => {
                const label = type === "deal" ? vocabulary.many : TYPE_LABELS[type];
                const count = counts?.[type] ?? 0;
                return (
                  <TabsTrigger key={type} value={type}>
                    {label}
                    <span className="ml-[var(--space-1)] tabular-nums text-[var(--color-text-muted)]">
                      {count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {TYPES.map((type) => (
              <TabsContent key={type} value={type}>
                <TrashTypeTable
                  entityType={type}
                  lowerPlural={type === "deal" ? vocabulary.lowerMany : TYPE_LOWER_PLURAL[type]}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}

function TrashTypeTable(props: {
  entityType: TrashEntityType;
  lowerPlural: string;
}): ReactElement | null {
  const { entityType, lowerPlural } = props;
  const listQuery = useQuery({
    queryKey: qk.trash(entityType),
    queryFn: () => trash.list(entityType),
  });
  const items = listQuery.data ?? [];

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<TrashItem | null>(null);
  const [preparingDeleteId, setPreparingDeleteId] = useState<string | null>(null);
  const [attachmentFileCount, setAttachmentFileCount] = useState<number | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);

  // A loading table shows nothing extra rather than a spinner or shimmer
  // (docs/DESIGN.md #8, Motion): the query settles fast against local SQLite.
  if (listQuery.isLoading) return null;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Trash2 size={24} aria-hidden="true" />}
        title="Nothing deleted"
        description={`Deleted ${lowerPlural} land here for 30 days so you can change your mind.`}
        // No action: once this list is empty there is nothing to do here.
        // This is the one legitimate exception to "every empty state has an
        // action" (docs/DESIGN.md #9, Empty states).
      />
    );
  }

  async function handleRestore(item: TrashItem) {
    setRestoringId(item.entityId);
    try {
      await trash.restore(item.entityType, item.entityId);
      await invalidateRecords();
      toast.success(`Restored ${item.label}`);
    } catch (err) {
      reportError(err, `${item.label} could not be restored.`);
    } finally {
      setRestoringId(null);
    }
  }

  async function openDeleteDialog(item: TrashItem) {
    setAttachmentFileCount(null);
    if (item.entityType === "attachment") {
      setPreparingDeleteId(item.entityId);
      try {
        const files = await trash.attachmentFilesFor(item.entityType, item.entityId);
        setAttachmentFileCount(files.length);
      } catch (err) {
        reportError(err, "Could not check this attachment's files.");
        return;
      } finally {
        setPreparingDeleteId(null);
      }
    }
    setConfirmTarget(item);
  }

  async function handlePurge() {
    const item = confirmTarget;
    if (!item) return;
    try {
      await trash.purge(item.entityType, item.entityId);
      await invalidateRecords();
      toast.success(`Deleted ${item.label} forever`);
    } catch (err) {
      reportError(err, `${item.label} could not be deleted.`);
    }
  }

  async function handleEmptyTrash() {
    const targets = items;
    let removed = 0;
    try {
      for (const item of targets) {
        await trash.purge(item.entityType, item.entityId);
        removed += 1;
      }
      await invalidateRecords();
      toast.success(`Deleted ${removed} ${lowerPlural} forever`);
    } catch {
      await invalidateRecords();
      const message = `Removed ${removed} of ${targets.length} ${lowerPlural} before this failed.`;
      reportError(new Error(message), message);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setEmptyTrashOpen(true)}>
          Empty the trash
        </Button>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>What it was</TH>
            <TH>Deleted</TH>
            <TH>Purges on</TH>
            <TH align="right">
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {items.map((item) => {
            const deletedDateOnly = toLocalDateString(new Date(item.deletedAt));
            const purgeDateOnly = addDaysToDateString(deletedDateOnly, trash.PURGE_AFTER_DAYS);
            const purgingSoon = purgeDateOnly <= todayLocal();

            return (
              <TR key={item.entityId}>
                <TD className="max-w-[280px] truncate" title={item.label}>
                  {item.label}
                </TD>
                <TD
                  className="tabular-nums"
                  title={formatDateTimeDisplay(item.deletedAt)}
                >
                  {formatRelative(item.deletedAt)}
                </TD>
                <TD className="tabular-nums">
                  <div className="flex items-center gap-[var(--space-2)]">
                    {formatDateDisplay(purgeDateOnly)}
                    {purgingSoon ? <Badge tone="warning">Purging soon</Badge> : null}
                  </div>
                </TD>
                <TD align="right">
                  <div className="flex items-center justify-end gap-[var(--space-2)]">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={restoringId === item.entityId}
                      onClick={() => void handleRestore(item)}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={preparingDeleteId === item.entityId}
                      className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                      onClick={() => void openDeleteDialog(item)}
                    >
                      Delete forever
                    </Button>
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget ? `Delete "${confirmTarget.label}" forever?` : ""}
        description={
          <>
            This removes it from Helix permanently. This one cannot be undone.
            {attachmentFileCount ? (
              <>
                {" "}
                {attachmentFileCount} file{attachmentFileCount === 1 ? "" : "s"} stay on disk in
                this workspace&apos;s attachments folder.
              </>
            ) : null}
          </>
        }
        confirmLabel="Delete forever"
        destructive
        onConfirm={handlePurge}
      />

      <ConfirmDialog
        open={emptyTrashOpen}
        onOpenChange={setEmptyTrashOpen}
        title={`Delete ${items.length} ${lowerPlural} forever?`}
        description="This removes them from Helix permanently. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={handleEmptyTrash}
      />
    </div>
  );
}
