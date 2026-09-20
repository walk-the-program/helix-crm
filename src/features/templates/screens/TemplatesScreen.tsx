/**
 * Settings > Templates.
 *
 * Two grouped inset lists, text messages then emails, in the same shape
 * TagsScreen and FieldsScreen use for theirs. Reorder is buttons that move a
 * row up and down (FieldsScreen's approach, not dnd-kit) because a template
 * list is short and a button is simpler to get right than a drag handle.
 *
 * The editor is one dialog for both create and edit, opened from the screen's
 * one primary button ("New template") or from either group's empty state. The
 * live preview renders against `SAMPLE_VALUES` through the same
 * `renderTemplate` a real send uses, so what the owner sees while writing a
 * template is exactly what a customer would see.
 */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  CardRow,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
  Tooltip,
  toast,
} from "@/ui";
import { CaretDown, CaretUp, ICON_SIZE_SM, ICON_WEIGHT_STRONG, PencilSimple } from "@/ui/icons";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsNotice,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import {
  useCreateTemplate,
  useDeleteTemplate,
  useReorderTemplates,
  useTemplates,
  useUpdateTemplate,
} from "@/features/templates/lib/hooks";
import {
  MERGE_FIELDS,
  MERGE_FIELD_LABELS,
  SAMPLE_VALUES,
  renderTemplate,
  unknownFieldsIn,
} from "@/features/templates/lib/merge";
import type { MergeField } from "@/features/templates/lib/merge";
import type { Template, TemplateKind } from "@/db/repos/templates";

const KIND_OPTIONS: { value: TemplateKind; label: string }[] = [
  { value: "text", label: "Text message" },
  { value: "email", label: "Email" },
];

/** Every field the editor can insert, spelled out once for the footnote. */
const MERGE_FIELDS_FOOTNOTE = MERGE_FIELDS.map(
  (field) => `{{${field}}} (${MERGE_FIELD_LABELS[field]})`,
).join("  ·  ");

/** The first ~70 characters of a body, flattened to one line for a row. */
function bodyPreview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function TemplateRow(props: {
  template: Template;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { template, isFirst, isLast, onMoveUp, onMoveDown, onEdit, onDelete } = props;

  return (
    <CardRow
      className="items-center gap-[var(--space-4)]"
      data-testid="template-row"
      data-template-name={template.name}
    >
      <span className="flex min-w-0 flex-col gap-[var(--space-1)] py-[var(--space-1)]">
        <span
          className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          title={template.name}
        >
          {template.name}
        </span>
        <span
          className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          title={template.body}
        >
          {bodyPreview(template.body)}
        </span>
      </span>
      <span className="flex flex-none items-center gap-[var(--space-1)]">
        <Tooltip content="Move up">
          <IconButton
            label={`Move "${template.name}" up`}
            size="sm"
            disabled={isFirst}
            data-testid="template-move-up"
            onClick={onMoveUp}
          >
            <CaretUp size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content="Move down">
          <IconButton
            label={`Move "${template.name}" down`}
            size="sm"
            disabled={isLast}
            data-testid="template-move-down"
            onClick={onMoveDown}
          >
            <CaretDown size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
          </IconButton>
        </Tooltip>
        <IconButton
          label={`Edit "${template.name}"`}
          size="sm"
          data-testid="template-edit"
          onClick={onEdit}
        >
          <PencilSimple size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
        </IconButton>
        <Button variant="destructive" size="sm" data-testid="template-delete" onClick={onDelete}>
          Delete
        </Button>
      </span>
    </CardRow>
  );
}

/* -------------------------------------------------------------------------- */
/* Group (one kind)                                                           */
/* -------------------------------------------------------------------------- */

function TemplateGroup(props: {
  label: string;
  kind: TemplateKind;
  templates: Template[];
  emptyTitle: string;
  emptyDescription: string;
  footnote?: string;
  onMove: (template: Template, direction: -1 | 1) => void;
  onEdit: (template: Template) => void;
  onDelete: (template: Template) => void;
  onNewOfKind: (kind: TemplateKind) => void;
}) {
  const {
    label,
    kind,
    templates,
    emptyTitle,
    emptyDescription,
    footnote,
    onMove,
    onEdit,
    onDelete,
    onNewOfKind,
  } = props;

  return (
    <SettingsGroup label={label} footnote={footnote} data-testid={`templates-group-${kind}`}>
      {templates.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button variant="secondary" onClick={() => onNewOfKind(kind)}>
              New {kind === "text" ? "text message" : "email"} template
            </Button>
          }
        />
      ) : (
        templates.map((template, index) => (
          <TemplateRow
            key={template.id}
            template={template}
            isFirst={index === 0}
            isLast={index === templates.length - 1}
            onMoveUp={() => onMove(template, -1)}
            onMoveDown={() => onMove(template, 1)}
            onEdit={() => onEdit(template)}
            onDelete={() => onDelete(template)}
          />
        ))
      )}
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor dialog - create and edit share the one form                        */
/* -------------------------------------------------------------------------- */

function TemplateEditorDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  defaultKind: TemplateKind;
}) {
  const { open, onOpenChange, template, defaultKind } = props;
  const editing = Boolean(template);

  const [kind, setKind] = useState<TemplateKind>(defaultKind);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const saving = create.isPending || update.isPending;

  // Reset on every open, keyed on the dialog opening rather than on every
  // keystroke, so Escape or the close button always abandons the draft and a
  // fresh open always starts clean.
  useEffect(() => {
    if (!open) return;
    setKind(template?.kind ?? defaultKind);
    setName(template?.name ?? "");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setNameError(null);
    setBodyError(null);
    setSaveError(null);
  }, [open, template, defaultKind]);

  function insertField(field: MergeField) {
    const token = `{{${field}}}`;
    const el = textareaRef.current;
    if (!el) {
      setBody((current) => current + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const unknownFields = Array.from(
    new Set([...unknownFieldsIn(body), ...(kind === "email" ? unknownFieldsIn(subject) : [])]),
  );
  const previewSubject = kind === "email" ? renderTemplate(subject, SAMPLE_VALUES) : null;
  const previewBody = renderTemplate(body, SAMPLE_VALUES);
  const sampleSentence = `Shown for ${SAMPLE_VALUES.first_name} ${SAMPLE_VALUES.last_name} at ${SAMPLE_VALUES.company}.`;

  async function save() {
    const trimmedName = name.trim();
    let hasError = false;
    if (trimmedName.length === 0) {
      setNameError("Give the template a name you will recognise.");
      hasError = true;
    } else {
      setNameError(null);
    }
    if (body.trim().length === 0) {
      setBodyError("A template needs something to say.");
      hasError = true;
    } else {
      setBodyError(null);
    }
    if (hasError) return;
    setSaveError(null);

    try {
      if (template) {
        await update.mutateAsync({
          id: template.id,
          patch: { name: trimmedName, subject: kind === "email" ? subject : null, body },
        });
        toast.success(`Saved "${trimmedName}"`);
      } else {
        await create.mutateAsync({
          kind,
          name: trimmedName,
          subject: kind === "email" ? subject : null,
          body,
        });
        toast.success(`Added "${trimmedName}"`);
      }
      onOpenChange(false);
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : "That template did not save.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="template-editor">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field
            label="Kind"
            htmlFor="template-kind"
            hint={
              editing
                ? "Set when the template is created. Changing a text message into an email would lose the subject."
                : undefined
            }
          >
            <div id="template-kind-control">
              <Select
                id="template-kind"
                ariaLabel="Kind"
                value={kind}
                disabled={editing}
                options={KIND_OPTIONS}
                onValueChange={(v) => setKind(v as TemplateKind)}
              />
            </div>
          </Field>

          <Field label="Name" htmlFor="template-name" required error={nameError ?? undefined}>
            <Input
              id="template-name"
              data-testid="template-name-input"
              placeholder="Quote follow-up"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>

          {kind === "email" ? (
            <Field label="Subject" htmlFor="template-subject">
              <Input
                id="template-subject"
                placeholder="Your quote from {{business_name}}"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Message" htmlFor="template-body" required error={bodyError ?? undefined}>
            <Textarea
              id="template-body"
              ref={textareaRef}
              rows={8}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (bodyError) setBodyError(null);
              }}
            />
          </Field>

          <div className="flex flex-wrap gap-[var(--space-2)]">
            {MERGE_FIELDS.map((field) => (
              <Tooltip key={field} content={MERGE_FIELD_LABELS[field]}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => insertField(field)}
                >
                  {`{{${field}}}`}
                </Button>
              </Tooltip>
            ))}
          </div>

          {unknownFields.length > 0 ? (
            <SettingsNotice data-testid="template-unknown-fields">
              {unknownFields.length === 1
                ? `Helix does not know {{${unknownFields[0]}}}. It will be sent exactly as written.`
                : `Helix does not know ${unknownFields
                    .map((field) => `{{${field}}}`)
                    .join(", ")}. They will be sent exactly as written.`}
            </SettingsNotice>
          ) : null}

          {saveError ? (
            <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
              {saveError}
            </p>
          ) : null}

          <SettingsGroup label="Preview">
            <div className="flex flex-col gap-[var(--space-2)] p-[var(--space-4)]">
              <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                {sampleSentence}
              </p>
              {previewSubject !== null ? (
                <p className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                  {previewSubject}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-[length:var(--text-base)] text-[var(--color-text)]">
                {previewBody}
              </p>
            </div>
          </SettingsGroup>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            loadingLabel="Saving"
            data-testid="template-save"
            onClick={() => void save()}
          >
            {editing ? "Save changes" : "Add template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function TemplatesScreen() {
  const templatesQuery = useTemplates();
  const templates = templatesQuery.data ?? [];
  const textTemplates = templates.filter((t) => t.kind === "text");
  const emailTemplates = templates.filter((t) => t.kind === "email");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editorDefaultKind, setEditorDefaultKind] = useState<TemplateKind>("text");
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);

  const reorderMutation = useReorderTemplates();
  const deleteMutation = useDeleteTemplate();

  function openCreate(kind: TemplateKind) {
    setEditingTemplate(null);
    setEditorDefaultKind(kind);
    setEditorOpen(true);
  }

  function openEdit(template: Template) {
    setEditingTemplate(template);
    setEditorDefaultKind(template.kind);
    setEditorOpen(true);
  }

  async function move(list: Template[], template: Template, direction: -1 | 1) {
    const index = list.findIndex((t) => t.id === template.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    try {
      await reorderMutation.mutateAsync(next.map((t) => t.id));
    } catch {
      toast.error("That order did not save.");
    }
  }

  const newTemplateButton = (
    <Button variant="primary" data-testid="template-new" onClick={() => openCreate("text")}>
      New template
    </Button>
  );

  return (
    <SettingsScreenFrame
      title="Templates"
      subtitle="The text messages and emails you send again and again."
      testId="templates-screen"
      actions={newTemplateButton}
    >
      {templatesQuery.isLoading ? (
        <SettingsLoading>Reading the database.</SettingsLoading>
      ) : (
        <>
          <TemplateGroup
            label="Text messages"
            kind="text"
            templates={textTemplates}
            emptyTitle="No text templates yet"
            emptyDescription="Add one for the message you send most - a quote follow-up, a running-late text."
            onMove={(template, direction) => void move(textTemplates, template, direction)}
            onEdit={openEdit}
            onDelete={setDeletingTemplate}
            onNewOfKind={openCreate}
          />

          <TemplateGroup
            label="Emails"
            kind="email"
            templates={emailTemplates}
            emptyTitle="No email templates yet"
            emptyDescription="Add one for the email you send most - a quote, a thank you."
            footnote={`Merge fields: ${MERGE_FIELDS_FOOTNOTE}`}
            onMove={(template, direction) => void move(emailTemplates, template, direction)}
            onEdit={openEdit}
            onDelete={setDeletingTemplate}
            onNewOfKind={openCreate}
          />
        </>
      )}

      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editingTemplate}
        defaultKind={editorDefaultKind}
      />

      <ConfirmDialog
        open={Boolean(deletingTemplate)}
        onOpenChange={(open) => {
          if (!open) setDeletingTemplate(null);
        }}
        title="Delete template"
        description={
          deletingTemplate
            ? `Delete "${deletingTemplate.name}"? You can undo this from the toast for the next ten seconds.`
            : undefined
        }
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          const template = deletingTemplate;
          if (!template) return;
          setDeletingTemplate(null);
          try {
            await deleteMutation.mutateAsync(template);
          } catch {
            toast.error(`Could not delete "${template.name}".`);
          }
        }}
      />
    </SettingsScreenFrame>
  );
}
