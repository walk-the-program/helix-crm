/**
 * Settings > Custom fields.
 *
 * The entity switch (Contacts / Companies / Deals) is chrome, not a setting,
 * so it sits directly under the page header as a plain segmented control -
 * not inside a group label or a panel of its own (docs/DESIGN.md §9 "Sidebar
 * and nav": a control that only points at a section is not itself a setting).
 * Below it is one grouped inset list per entity, a CardRow per field, in the
 * same shape WorkspacesScreen uses for its rows. The kind badge is gone: a
 * grey pill on every row was noise, and a field's kind is not a status - it
 * now reads as a plain second line under the name, the way a Finder list
 * subtitles a file with its kind and size.
 *
 * "Add a field" is the screen's one black button, and it is in exactly one
 * place at a time: the header when there are fields, the empty state when there
 * are none (docs/DESIGN.md §9 - one primary button per screen, and an empty
 * state is a title, a sentence and one button).
 *
 * A destructive action always names the record and what it costs before it
 * runs (docs/DESIGN.md §7 "no dark patterns"). The mutations, `move()`,
 * `parseOptions`, `optionsFromText` and every toast string are unchanged.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ICON_SIZE_SM, ICON_WEIGHT_STRONG, Pencil, Trash2 } from "@/ui/icons";
import {
  Button,
  CardRow,
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
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@/ui";
import { cn } from "@/ui/cn";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import { qk, queryClient } from "@/app/queryClient";
import { settingsKeys, useCustomFields } from "@/features/settings/lib/queries";
import { customFieldValueCount } from "@/features/settings/lib/counts";
import * as customFieldsRepo from "@/db/repos/customFields";
import type { CustomField, CustomFieldKind } from "@/db/repos/customFields";

type EntityType = "contact" | "company" | "deal";

const ENTITY_OPTIONS: { value: EntityType; label: string; plural: string }[] = [
  { value: "contact", label: "Contacts", plural: "contacts" },
  { value: "company", label: "Companies", plural: "companies" },
  { value: "deal", label: "Deals", plural: "deals" },
];

const KIND_OPTIONS: { value: CustomFieldKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "choice", label: "Choice" },
];

function kindLabel(kind: CustomFieldKind): string {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

function parseOptions(optionsJson: string | null): string[] {
  if (!optionsJson) return [];
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function optionsFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Name + kind + (for "choice") options - shared by the create and edit forms */
/* -------------------------------------------------------------------------- */

function FieldNameAndKind(props: {
  name: string;
  onNameChange: (v: string) => void;
  kind: CustomFieldKind;
  onKindChange?: (v: CustomFieldKind) => void;
  optionsText: string;
  onOptionsTextChange: (v: string) => void;
}) {
  const { name, onNameChange, kind, onKindChange, optionsText, onOptionsTextChange } = props;
  const kindLocked = !onKindChange;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <Field label="Name" htmlFor="field-name" required>
        <Input
          id="field-name"
          data-testid="field-name-input"
          placeholder="Gate code"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
      </Field>
      {kindLocked ? (
        // A kind that cannot change is a statement, not a control, so it is not
        // wrapped in a Field: a <label for> pointing at a paragraph is a broken
        // promise to a screen reader. The label typography is Field's, so the
        // block still lines up with the fields above and below it.
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Kind
          </span>
          <p className="text-[length:var(--text-base)] text-[var(--color-text)]">
            {kindLabel(kind)}
          </p>
        </div>
      ) : (
        // htmlFor names the Select's own trigger, which is a button and so is
        // labelable; the wrapper carries its own id purely so Field leaves it
        // alone and the two ids cannot collide.
        <Field label="Kind" htmlFor="field-kind">
          <div id="field-kind-control" data-testid="field-kind-select">
            <Select
              id="field-kind"
              value={kind}
              onValueChange={(v) => onKindChange(v as CustomFieldKind)}
              options={KIND_OPTIONS}
              ariaLabel="Kind"
            />
          </div>
        </Field>
      )}
      {kind === "choice" ? (
        <Field label="Options" htmlFor="field-options" hint="One option per line.">
          <Textarea
            id="field-options"
            data-testid="field-options-input"
            rows={4}
            placeholder={"Yes\nNo"}
            value={optionsText}
            onChange={(e) => onOptionsTextChange(e.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create dialog                                                              */
/* -------------------------------------------------------------------------- */

function CreateFieldDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (input: { name: string; kind: CustomFieldKind; optionsJson: string | null }) => void;
}) {
  const { open, onOpenChange, pending, onSubmit } = props;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CustomFieldKind>("text");
  const [optionsText, setOptionsText] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setKind("text");
      setOptionsText("");
    }
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    const optionsJson = kind === "choice" ? JSON.stringify(optionsFromText(optionsText)) : null;
    onSubmit({ name: trimmedName, kind, optionsJson });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a field</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-4)]">
          <FieldNameAndKind
            name={name}
            onNameChange={setName}
            kind={kind}
            onKindChange={setKind}
            optionsText={optionsText}
            onOptionsTextChange={setOptionsText}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} data-testid="field-create">
              Add field
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit dialog                                                                */
/* -------------------------------------------------------------------------- */

function EditFieldDialog(props: {
  field: CustomField | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (id: string, name: string, optionsJson: string | null) => void;
}) {
  const { field, onOpenChange, pending, onSubmit } = props;
  const [name, setName] = useState("");
  const [optionsText, setOptionsText] = useState("");

  useEffect(() => {
    if (field) {
      setName(field.name);
      setOptionsText(parseOptions(field.optionsJson).join("\n"));
    }
  }, [field]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!field) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    const optionsJson =
      field.kind === "choice" ? JSON.stringify(optionsFromText(optionsText)) : null;
    onSubmit(field.id, trimmedName, optionsJson);
  }

  return (
    <Dialog open={Boolean(field)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit field</DialogTitle>
        </DialogHeader>
        {field ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-4)]">
            <FieldNameAndKind
              name={name}
              onNameChange={setName}
              kind={field.kind}
              optionsText={optionsText}
              onOptionsTextChange={setOptionsText}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete dialog                                                              */
/* -------------------------------------------------------------------------- */

function DeleteFieldDialog(props: {
  field: CustomField | null;
  entityPlural: string;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { field, entityPlural, onOpenChange, pending, onConfirm } = props;
  const countQuery = useQuery({
    queryKey: settingsKeys.fieldValueCounts(field?.id ?? ""),
    queryFn: () => customFieldValueCount(field!.id),
    enabled: Boolean(field),
  });
  const count = countQuery.data ?? 0;

  return (
    <Dialog open={Boolean(field)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete field</DialogTitle>
        </DialogHeader>
        {field ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {`Delete "${field.name}"? ${count} ${entityPlural} ${
              count === 1 ? "has" : "have"
            } a value in it, and those values go too.`}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            data-testid="field-confirm-delete"
            onClick={onConfirm}
          >
            Delete field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function FieldRow(props: {
  field: CustomField;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { field, isFirst, isLast, onMoveUp, onMoveDown, onEdit, onDelete } = props;
  const options = parseOptions(field.optionsJson);
  const detail =
    field.kind === "choice" && options.length > 0
      ? `${kindLabel(field.kind)} · ${options.join(", ")}`
      : kindLabel(field.kind);

  return (
    <CardRow
      className={cn("items-center gap-[var(--space-4)]", isLast && "border-b-0")}
      data-testid="field-row"
      data-field-name={field.name}
    >
      <span className="flex min-w-0 flex-col gap-[var(--space-1)] py-[var(--space-1)]">
        <span
          className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          title={field.name}
        >
          {field.name}
        </span>
        <span className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {detail}
        </span>
      </span>
      <span className="flex flex-none items-center gap-[var(--space-1)]">
        <IconButton
          label={`Move "${field.name}" up`}
          size="sm"
          disabled={isFirst}
          data-testid="field-move-up"
          onClick={onMoveUp}
        >
          <ArrowUp size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
        </IconButton>
        <IconButton
          label={`Move "${field.name}" down`}
          size="sm"
          disabled={isLast}
          data-testid="field-move-down"
          onClick={onMoveDown}
        >
          <ArrowDown size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
        </IconButton>
        <IconButton label={`Edit "${field.name}"`} size="sm" onClick={onEdit}>
          <Pencil size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
        </IconButton>
        <IconButton
          label={`Delete "${field.name}"`}
          size="sm"
          variant="danger"
          data-testid="field-delete"
          onClick={onDelete}
        >
          <Trash2 size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
        </IconButton>
      </span>
    </CardRow>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function FieldsScreen() {
  const [entityType, setEntityType] = useState<EntityType>("contact");
  const fieldsQuery = useCustomFields(entityType);
  const fields = fieldsQuery.data ?? [];
  const entityLabel = ENTITY_OPTIONS.find((o) => o.value === entityType)!;

  const [createOpen, setCreateOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [deletingField, setDeletingField] = useState<CustomField | null>(null);

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: qk.customFields(entityType) });
  }

  const createMutation = useMutation({
    mutationFn: (input: { name: string; kind: CustomFieldKind; optionsJson: string | null }) =>
      customFieldsRepo.create({ entityType, position: fields.length, ...input }),
    onSuccess: async () => {
      await invalidate();
      setCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; name: string; optionsJson: string | null }) =>
      customFieldsRepo.update(vars.id, { name: vars.name, optionsJson: vars.optionsJson }),
    onSuccess: async () => {
      await invalidate();
      setEditingField(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (field: CustomField) => customFieldsRepo.softDelete(field.id),
    onSuccess: async (_result, field) => {
      await invalidate();
      toast.success(`Deleted the field "${field.name}"`);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => customFieldsRepo.reorder(orderedIds),
    onSuccess: () => invalidate(),
  });

  async function move(field: CustomField, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.id === field.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    await reorderMutation.mutateAsync(next.map((f) => f.id));
  }

  const addFieldButton = (
    <Button variant="primary" data-testid="field-add-open" onClick={() => setCreateOpen(true)}>
      Add a field
    </Button>
  );

  return (
    <SettingsScreenFrame
      title="Custom fields"
      subtitle="Extra fields on a contact, company or deal."
      testId="settings-fields"
      actions={fields.length > 0 ? addFieldButton : undefined}
    >
      <Tabs value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
        <TabsList>
          {ENTITY_OPTIONS.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              data-testid={`field-entity-${option.value}`}
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {fieldsQuery.isLoading ? (
        <SettingsLoading>Reading the field list…</SettingsLoading>
      ) : fields.length === 0 ? (
        <EmptyState
          title={`No custom fields for ${entityLabel.plural} yet`}
          description={`Add a field to track something on a ${entityType} that the built-in fields don't cover.`}
          action={addFieldButton}
        />
      ) : (
        <SettingsGroup label={entityLabel.label}>
          {fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              isFirst={index === 0}
              isLast={index === fields.length - 1}
              onMoveUp={() => void move(field, -1)}
              onMoveDown={() => void move(field, 1)}
              onEdit={() => setEditingField(field)}
              onDelete={() => setDeletingField(field)}
            />
          ))}
        </SettingsGroup>
      )}

      <CreateFieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createMutation.isPending}
        onSubmit={(input) => createMutation.mutate(input)}
      />

      <EditFieldDialog
        field={editingField}
        onOpenChange={(open) => {
          if (!open) setEditingField(null);
        }}
        pending={updateMutation.isPending}
        onSubmit={(id, name, optionsJson) => updateMutation.mutate({ id, name, optionsJson })}
      />

      <DeleteFieldDialog
        field={deletingField}
        entityPlural={entityLabel.plural}
        onOpenChange={(open) => {
          if (!open) setDeletingField(null);
        }}
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deletingField) return;
          await deleteMutation.mutateAsync(deletingField);
          setDeletingField(null);
        }}
      />
    </SettingsScreenFrame>
  );
}
