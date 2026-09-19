/**
 * The timeline, shared by the contact, company and deal pages.
 *
 * Adding is two clicks: pick the kind, type, press Save (or Cmd+Enter). User
 * entries can be edited and deleted; system entries — a stage move, an import,
 * a lead arriving — are rendered differently and carry no controls, because
 * the repository refuses to change them.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  MessageSquare,
  Mail,
  Phone,
  Settings2,
  StickyNote,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Textarea,
  Tooltip,
} from "@/ui";
import * as activitiesRepo from "@/db/repos/activities";
import type { Activity, ActivityKind } from "@/db/repos/activities";
import { useActivities } from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  reportError,
} from "@/features/records/lib/mutations";
import { formatDateTimeDisplay, formatRelative } from "@/lib/dates";

const USER_KINDS: { kind: ActivityKind; label: string; icon: ReactNode }[] = [
  { kind: "note", label: "Note", icon: <StickyNote size={16} aria-hidden="true" /> },
  { kind: "call", label: "Call", icon: <Phone size={16} aria-hidden="true" /> },
  { kind: "email", label: "Email", icon: <Mail size={16} aria-hidden="true" /> },
  { kind: "meeting", label: "Meeting", icon: <CalendarDays size={16} aria-hidden="true" /> },
  { kind: "text", label: "Text", icon: <MessageSquare size={16} aria-hidden="true" /> },
];

const KIND_ICON: Record<ActivityKind, ReactNode> = {
  note: <StickyNote size={16} aria-hidden="true" />,
  call: <Phone size={16} aria-hidden="true" />,
  email: <Mail size={16} aria-hidden="true" />,
  meeting: <CalendarDays size={16} aria-hidden="true" />,
  text: <MessageSquare size={16} aria-hidden="true" />,
  system: <Settings2 size={16} aria-hidden="true" />,
};

const KIND_LABEL: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  text: "Text",
  system: "Helix",
};

export type TimelineProps = {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  /** Company pages merge in every activity of that company's contacts. */
  mergedForCompanyId?: string;
  title?: string;
  /**
   * Optionally controlled, so a record header's "Log a call" can open the
   * composer on the right kind without remounting the list.
   */
  composingKind?: ActivityKind | null;
  onComposingKindChange?: (kind: ActivityKind | null) => void;
  /**
   * Stretch to the height of the grid row. The contact and deal pages put the
   * timeline beside a tall details column, and a short card floating in a tall
   * empty space reads as a broken layout.
   */
  fill?: boolean;
};

export function Timeline(props: TimelineProps) {
  const { contactId, companyId, dealId, mergedForCompanyId, title = "Timeline" } = props;
  const [uncontrolled, setUncontrolled] = useState<ActivityKind | null>(null);
  const controlled = props.composingKind !== undefined;
  const composing = controlled ? props.composingKind ?? null : uncontrolled;
  const setComposing = (
    next: ActivityKind | null | ((current: ActivityKind | null) => ActivityKind | null),
  ) => {
    const value = typeof next === "function" ? next(composing) : next;
    if (controlled) props.onComposingKindChange?.(value);
    else setUncontrolled(value);
  };
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [confirming, setConfirming] = useState<Activity | null>(null);

  const filter = mergedForCompanyId
    ? { mergedForCompanyId }
    : { contactId, companyId, dealId };
  const query = useActivities(filter);
  const entries = query.data?.rows ?? [];

  async function addEntry() {
    if (!composing) return;
    const text = body.trim();
    if (text.length === 0) return;
    setSaving(true);
    try {
      await activitiesRepo.create({
        kind: composing,
        body: text,
        contactId: contactId ?? null,
        companyId: companyId ?? mergedForCompanyId ?? null,
        dealId: dealId ?? null,
      });
      await invalidateRecords();
      setBody("");
      setComposing(null);
    } catch (err) {
      reportError(err, "That entry did not save.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(entry: Activity, text: string) {
    try {
      await activitiesRepo.update(entry.id, { body: text.trim() });
      await invalidateRecords();
      setEditing(null);
    } catch (err) {
      reportError(err, "That entry did not save.");
    }
  }

  return (
    <Card className={props.fill ? "flex h-full flex-col" : undefined}>
      <CardHeader className={props.fill ? "shrink-0" : undefined}>
        <CardTitle>{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          {USER_KINDS.map((option) => (
            <Button
              key={option.kind}
              size="sm"
              variant={composing === option.kind ? "primary" : "ghost"}
              iconLeft={option.icon}
              aria-pressed={composing === option.kind}
              onClick={() => {
                setComposing((current) => (current === option.kind ? null : option.kind));
                setEditing(null);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardBody
        className={[
          "flex flex-col gap-[var(--space-4)]",
          props.fill ? "min-h-0 flex-1 overflow-y-auto" : "",
        ].join(" ")}
      >
        {composing ? (
          <div className="flex flex-col gap-[var(--space-2)]">
            <label
              htmlFor="timeline-composer"
              className="text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              {KIND_LABEL[composing]}
            </label>
            <Textarea
              id="timeline-composer"
              autoFocus
              rows={3}
              value={body}
              placeholder={placeholderFor(composing)}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void addEntry();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setComposing(null);
                  setBody("");
                }
              }}
            />
            <div className="flex items-center gap-[var(--space-2)]">
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                disabled={body.trim().length === 0}
                onClick={() => void addEntry()}
              >
                Save {KIND_LABEL[composing].toLowerCase()}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setComposing(null);
                  setBody("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {entries.length === 0 && !query.isLoading ? (
          <EmptyState
            icon={<StickyNote size={24} aria-hidden="true" />}
            title="Nothing logged yet"
            description="Every call, text and note you record here shows up in date order, newest first."
            action={
              <Button variant="primary" onClick={() => setComposing("note")}>
                Add the first note
              </Button>
            }
          />
        ) : null}

        <ol className="flex flex-col gap-[var(--space-3)]">
          {entries.map((entry) => (
            <li key={entry.id}>
              {editing?.id === entry.id ? (
                <TimelineEditor
                  entry={entry}
                  onCancel={() => setEditing(null)}
                  onSave={(text) => saveEdit(entry, text)}
                />
              ) : (
                <TimelineRow
                  entry={entry}
                  onEdit={() => setEditing(entry)}
                  onDelete={() => setConfirming(entry)}
                />
              )}
            </li>
          ))}
        </ol>
      </CardBody>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Delete this entry?"
        description="It moves to Trash and can be restored for 30 days."
        confirmLabel="Delete entry"
        destructive
        onConfirm={async () => {
          const entry = confirming;
          if (!entry) return;
          setConfirming(null);
          try {
            await deleteWithUndo({
              label: "1 timeline entry",
              remove: (batchId) => activitiesRepo.softDelete(entry.id, { batchId }),
              restore: (batchId) => activitiesRepo.restore(entry.id, { batchId }),
            });
          } catch (err) {
            reportError(err, "That entry could not be deleted.");
          }
        }}
      />
    </Card>
  );
}

function placeholderFor(kind: ActivityKind): string {
  switch (kind) {
    case "call":
      return "What was said, and what happens next.";
    case "email":
      return "What you sent, and what you asked for.";
    case "meeting":
      return "Who was there and what was agreed.";
    case "text":
      return "What you texted.";
    default:
      return "What happened.";
  }
}

function TimelineRow(props: {
  entry: Activity;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { entry, onEdit, onDelete } = props;
  const system = entry.isSystem;

  return (
    <div
      data-kind={entry.kind}
      data-system={system ? "true" : "false"}
      className={[
        "group flex gap-[var(--space-3)] rounded-[var(--radius-md)] border p-[var(--space-3)]",
        system
          ? "border-dashed border-[var(--color-border)] bg-[var(--color-bg)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]",
      ].join(" ")}
    >
      <span
        className={[
          "mt-[2px] inline-flex h-[var(--space-6)] w-[var(--space-6)] shrink-0 items-center justify-center",
          "rounded-[var(--radius-full)]",
          system
            ? "bg-[var(--color-bg)] text-[var(--color-text-faint)]"
            : "bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]",
        ].join(" ")}
        aria-hidden="true"
      >
        {KIND_ICON[entry.kind]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-[var(--space-2)]">
          <span
            className={[
              "text-[length:var(--text-sm)] font-medium",
              system ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]",
            ].join(" ")}
          >
            {KIND_LABEL[entry.kind]}
          </span>
          <Tooltip content={formatDateTimeDisplay(entry.occurredAt)}>
            <time
              dateTime={entry.occurredAt}
              className="tabular text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
            >
              {formatRelative(entry.occurredAt)}
            </time>
          </Tooltip>
          {system ? (
            <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
              written by Helix
            </span>
          ) : null}
        </div>
        <p
          className={[
            "mt-[var(--space-1)] whitespace-pre-wrap break-words text-[length:var(--text-base)]",
            system ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]",
          ].join(" ")}
        >
          {entry.body}
        </p>
      </div>

      {system ? null : (
        <div className="flex shrink-0 items-start gap-[var(--space-1)]">
          <IconButton
            label="Edit entry"
            size="sm"
            icon={<Pencil size={16} aria-hidden="true" />}
            onClick={onEdit}
          />
          <IconButton
            label="Delete entry"
            size="sm"
            variant="danger"
            icon={<Trash2 size={16} aria-hidden="true" />}
            onClick={onDelete}
          />
        </div>
      )}
    </div>
  );
}

function TimelineEditor(props: {
  entry: Activity;
  onSave: (body: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(props.entry.body);

  return (
    <div className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)]">
      <label htmlFor={`edit-${props.entry.id}`} className="sr-only">
        Edit entry
      </label>
      <Textarea
        id={`edit-${props.entry.id}`}
        autoFocus
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void props.onSave(text);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div className="flex items-center gap-[var(--space-2)]">
        <Button
          variant="primary"
          size="sm"
          disabled={text.trim().length === 0}
          onClick={() => void props.onSave(text)}
        >
          Save changes
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
