/**
 * Settings > Custom fields.
 *
 * DESIGN.md: one primary button per screen (creating a field), a destructive
 * action always names the record and what it costs before it runs, and every
 * control keeps its shared height and focus ring.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
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
  Table,
  TBody,
  TD,
  TH,
  THead,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  TR,
  toast,
} from "@/ui";
import {
  SettingsBlock,
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
        <Field label="Kind" htmlFor="field-kind-locked">
          <p
            id="field-kind-locked"
            className="text-[length:var(--text-base)] text-[var(--color-text)]"
          >
            {kindLabel(kind)}
          </p>
        </Field>
      ) : (
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
            Kind
          </span>
          <div data-testid="field-kind-select">
            <Select
              id="field-kind"
              value={kind}
              onValueChange={(v) => onKindChange(v as CustomFieldKind)}
              options={KIND_OPTIONS}
              ariaLabel="Kind"
            />
          </div>
        </div>
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
              variant="secondary"
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
                variant="secondary"
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
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
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
/* Table row                                                                  */
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

  return (
    <TR data-testid="field-row" data-field-name={field.name}>
      <TD>
        <span
          className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          title={field.name}
        >
          {field.name}
        </span>
      </TD>
      <TD>
        <Badge tone="neutral">{kindLabel(field.kind)}</Badge>
      </TD>
      <TD>
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {field.kind === "choice" ? options.join(", ") : "—"}
        </span>
      </TD>
      <TD align="right">
        <div className="flex items-center justify-end gap-[var(--space-1)]">
          <IconButton
            label={`Move "${field.name}" up`}
            size="sm"
            disabled={isFirst}
            data-testid="field-move-up"
            onClick={onMoveUp}
          >
            <ArrowUp className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Move "${field.name}" down`}
            size="sm"
            disabled={isLast}
            data-testid="field-move-down"
            onClick={onMoveDown}
          >
            <ArrowDown className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />
          </IconButton>
          <IconButton label={`Edit "${field.name}"`} size="sm" onClick={onEdit}>
            <Pencil className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Delete "${field.name}"`}
            size="sm"
            variant="danger"
            data-testid="field-delete"
            onClick={onDelete}
          >
            <Trash2 className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />
          </IconButton>
        </div>
      </TD>
    </TR>
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
    <Button
      variant="primary"
      iconLeft={<Plus className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />}
      data-testid="field-add-open"
      onClick={() => setCreateOpen(true)}
    >
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
      <SettingsBlock title="Entity">
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
      </SettingsBlock>

      <SettingsBlock title={entityLabel.label}>
        {fields.length === 0 ? (
          <EmptyState
            icon={<Layers size={24} aria-hidden="true" />}
            title={`No custom fields for ${entityLabel.plural} yet`}
            description={`Add a field to track something on a ${entityType} that the built-in fields don't cover.`}
            action={addFieldButton}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Kind</TH>
                <TH>Options</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
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
            </TBody>
          </Table>
        )}
      </SettingsBlock>

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
