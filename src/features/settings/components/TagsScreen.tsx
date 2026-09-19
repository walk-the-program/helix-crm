/**
 * Settings > Tags.
 *
 * DESIGN.md: one primary button per screen (Add tag), colour is never the
 * only carrier of meaning (the name is always shown in full-strength text
 * next to the swatch), and a destructive action always asks first in plain
 * words naming the record and its usage.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from "@/ui";
import {
  SettingsBlock,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import { qk, queryClient } from "@/app/queryClient";
import { settingsKeys, useTagCounts, useTags } from "@/features/settings/lib/queries";
import * as tagsRepo from "@/db/repos/tags";
import type { Tag as TagRecord } from "@/db/repos/tags";

const TAG_COLORS: { token: string; name: string }[] = [
  { token: "var(--stage-1)", name: "Sage" },
  { token: "var(--stage-2)", name: "Cyan" },
  { token: "var(--stage-3)", name: "Indigo" },
  { token: "var(--stage-4)", name: "Deep teal" },
  { token: "var(--stage-5)", name: "Green" },
  { token: "var(--stage-6)", name: "Mauve" },
  { token: "var(--stage-7)", name: "Orchid" },
  { token: "var(--stage-8)", name: "Moss" },
  { token: "var(--color-border-strong)", name: "Neutral" },
];
const DEFAULT_COLOR = TAG_COLORS[0].token;

function colorName(token: string): string {
  return TAG_COLORS.find((c) => c.token === token)?.name ?? "Neutral";
}

/* -------------------------------------------------------------------------- */
/* Colour picker - eight stage-ramp swatches plus neutral, as a radiogroup    */
/* -------------------------------------------------------------------------- */

function ColorSwatchPicker(props: {
  value: string;
  onChange: (token: string) => void;
  "aria-label": string;
}) {
  const { value, onChange } = props;
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className="flex flex-wrap gap-[var(--space-2)]"
    >
      {TAG_COLORS.map((c) => {
        const checked = c.token === value;
        return (
          <button
            key={c.token}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.token)}
            className={cn(
              "h-[var(--space-8)] w-[var(--space-8)] shrink-0 rounded-[var(--radius-full)]",
              "border-2 transition-colors",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
              checked ? "border-[var(--color-text)]" : "border-transparent",
            )}
            style={{ background: c.token }}
          />
        );
      })}
    </div>
  );
}

function LabelledColorPicker(props: {
  label: string;
  value: string;
  onChange: (token: string) => void;
  showName?: boolean;
}) {
  const { label, value, onChange, showName } = props;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
        {label}
      </span>
      <ColorSwatchPicker value={value} onChange={onChange} aria-label={label} />
      {showName ? (
        <span className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
          {colorName(value)}
        </span>
      ) : null}
    </div>
  );
}

function TagSwatch(props: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[var(--space-3)] w-[var(--space-3)] shrink-0 rounded-[var(--radius-full)]"
      style={{ background: props.color }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Create row                                                                 */
/* -------------------------------------------------------------------------- */

function CreateTagForm(props: {
  pending: boolean;
  onCreate: (input: { name: string; color: string }) => void;
}) {
  const { pending, onCreate } = props;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [nameError, setNameError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setNameError("Give this tag a name.");
      return;
    }
    setNameError(null);
    onCreate({ name: trimmedName, color });
    setName("");
    setColor(DEFAULT_COLOR);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-[var(--space-4)]">
      <div className="w-[240px]">
        <Field label="Name" htmlFor="new-tag-name" error={nameError ?? undefined}>
          <Input
            id="new-tag-name"
            data-testid="tag-name-input"
            placeholder="Repeat customer"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
          />
        </Field>
      </div>
      <LabelledColorPicker label="Colour" value={color} onChange={setColor} />
      <Button
        type="submit"
        variant="primary"
        iconLeft={<Plus className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />}
        loading={pending}
        data-testid="tag-add"
      >
        Add tag
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Rename / recolour dialog                                                   */
/* -------------------------------------------------------------------------- */

function EditTagDialog(props: {
  tag: TagRecord | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSave: (id: string, name: string, color: string) => void;
}) {
  const { tag, onOpenChange, pending, onSave } = props;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  useEffect(() => {
    if (tag) {
      setName(tag.name);
      setColor(tag.color);
    }
  }, [tag]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tag) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    onSave(tag.id, trimmedName, color);
  }

  return (
    <Dialog open={Boolean(tag)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Rename and recolour tag</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-4)]">
          <Field label="Name" htmlFor="edit-tag-name">
            <Input
              id="edit-tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <LabelledColorPicker label="Colour" value={color} onChange={setColor} showName />
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
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete dialog                                                              */
/* -------------------------------------------------------------------------- */

function DeleteTagDialog(props: {
  tag: TagRecord | null;
  count: number;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { tag, count, onOpenChange, pending, onConfirm } = props;
  return (
    <Dialog open={Boolean(tag)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete tag</DialogTitle>
        </DialogHeader>
        {tag ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {count === 0
              ? `Delete "${tag.name}"? Nothing is tagged with it.`
              : `Delete "${tag.name}"? It is on ${count} ${
                  count === 1 ? "record" : "records"
                }. They keep their history; the tag comes off them.`}
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
            data-testid="tag-confirm-delete"
            onClick={onConfirm}
          >
            Delete tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Table row                                                                  */
/* -------------------------------------------------------------------------- */

function TagRow(props: {
  tag: TagRecord;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { tag, count, onEdit, onDelete } = props;
  return (
    <TR data-testid="tag-row" data-tag-name={tag.name}>
      <TD>
        <span className="inline-flex items-center gap-[var(--space-2)]">
          <TagSwatch color={tag.color} />
          <span
            className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
            title={tag.name}
          >
            {tag.name}
          </span>
        </span>
      </TD>
      <TD align="right">
        <Badge tone="neutral">{count}</Badge>
      </TD>
      <TD align="right">
        <div className="flex items-center justify-end gap-[var(--space-1)]">
          <IconButton label={`Rename or recolour "${tag.name}"`} size="sm" onClick={onEdit}>
            <Pencil className="h-[var(--space-4)] w-[var(--space-4)]" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Delete "${tag.name}"`}
            size="sm"
            variant="danger"
            data-testid="tag-delete"
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

export function TagsScreen() {
  const tagsQuery = useTags();
  const countsQuery = useTagCounts();
  const tags = tagsQuery.data?.rows ?? [];
  const countByTagId = new Map((countsQuery.data ?? []).map((c) => [c.tagId, c.count]));

  const [editingTag, setEditingTag] = useState<TagRecord | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null);

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: qk.tags() });
    await queryClient.invalidateQueries({ queryKey: settingsKeys.tagCounts() });
  }

  const createMutation = useMutation({
    mutationFn: (input: { name: string; color: string }) => tagsRepo.create(input),
    onSuccess: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; name: string; color: string }) =>
      tagsRepo.update(vars.id, { name: vars.name, color: vars.color }),
    onSuccess: async () => {
      await invalidate();
      setEditingTag(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (tag: TagRecord) => tagsRepo.softDelete(tag.id),
    onSuccess: async (_result, tag) => {
      await invalidate();
      toast.success(`Deleted the tag "${tag.name}"`);
    },
  });

  return (
    <SettingsScreenFrame
      title="Tags"
      subtitle="The labels you put on people, companies and deals."
      testId="settings-tags"
    >
      <SettingsBlock
        title="Add a tag"
        description="Tags carry over history. Deleting one removes the label, never the record."
      >
        <CreateTagForm
          pending={createMutation.isPending}
          onCreate={(input) => createMutation.mutate(input)}
        />
      </SettingsBlock>

      <SettingsBlock title="All tags">
        {tags.length === 0 ? (
          <EmptyState
            icon={<TagIcon size={24} aria-hidden="true" />}
            title="No tags yet"
            description="Tags fill up as you label contacts, companies and deals. Add one above and it shows up everywhere you can tag a record."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH align="right">Usage</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {tags.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  count={countByTagId.get(tag.id) ?? 0}
                  onEdit={() => setEditingTag(tag)}
                  onDelete={() => setDeletingTag(tag)}
                />
              ))}
            </TBody>
          </Table>
        )}
      </SettingsBlock>

      <EditTagDialog
        tag={editingTag}
        onOpenChange={(open) => {
          if (!open) setEditingTag(null);
        }}
        pending={updateMutation.isPending}
        onSave={(id, name, color) => updateMutation.mutate({ id, name, color })}
      />

      <DeleteTagDialog
        tag={deletingTag}
        count={deletingTag ? countByTagId.get(deletingTag.id) ?? 0 : 0}
        onOpenChange={(open) => {
          if (!open) setDeletingTag(null);
        }}
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deletingTag) return;
          await deleteMutation.mutateAsync(deletingTag);
          setDeletingTag(null);
        }}
      />
    </SettingsScreenFrame>
  );
}
