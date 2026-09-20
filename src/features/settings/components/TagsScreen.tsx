/**
 * Settings > Tags.
 *
 * A single grouped inset list, the way WorkspacesScreen lists workspaces: the
 * swatch and the name carry the row, the usage sentence and the row actions
 * sit on the right, and colour is never the only carrier of meaning - the name
 * is always shown in full ink next to the swatch. Creating a tag is the
 * screen's one dialog, opened from the frame's primary button. That button is
 * in the header when there are tags and in the empty state when there are
 * none, never in both at once, because the screen gets one block of primary
 * and no more.
 *
 * The swatches are squares. The brand's corner language is radius 0 on every
 * control and card, and a round dot beside square everything else is the one
 * shape that gives the screen away as a web app.
 *
 * A destructive action always names the record and what it costs before it
 * runs.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ICON_SIZE_SM, ICON_WEIGHT_STRONG, Pencil, Trash2 } from "@/ui/icons";
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
  toast,
} from "@/ui";
import { cn } from "@/ui/cn";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import { qk, queryClient } from "@/app/queryClient";
import { settingsKeys, useTagCounts, useTags } from "@/features/settings/lib/queries";
import * as tagsRepo from "@/db/repos/tags";
import type { Tag as TagRecord } from "@/db/repos/tags";

/**
 * The eight stage-ramp colours, named as the owner sees them.
 *
 * The names are what a screen reader reads out and what the row says beside the
 * swatch, so they have to match the colour the token actually paints. They did
 * not: the ramp was re-derived from the brand family in the final integration
 * pass (see the comment block in src/styles/tokens.css) and these names were
 * left behind from a ramp two revisions ago - "Mauve" sat on a red and "Moss"
 * on a yellow. They are the current eight.
 */
const TAG_COLORS: { token: string; name: string }[] = [
  { token: "var(--stage-1)", name: "Slate" },
  { token: "var(--stage-2)", name: "Blue" },
  { token: "var(--stage-3)", name: "Lavender" },
  { token: "var(--stage-4)", name: "Teal" },
  { token: "var(--stage-5)", name: "Green" },
  { token: "var(--stage-6)", name: "Brick" },
  { token: "var(--stage-7)", name: "Tan" },
  { token: "var(--stage-8)", name: "Olive" },
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
              // A 24px square swatch. The selected one is marked by an ink
              // hairline rather than a 2px ring, which reads as a web control.
              "h-[var(--space-6)] w-[var(--space-6)] shrink-0",
              "border transition-colors duration-[var(--dur-fast)] motion-reduce:transition-none",
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
      {/* Same typography as the Field primitive's label, so a colour picker
          sitting under a text field does not shout louder than it. */}
      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {label}
      </span>
      <ColorSwatchPicker value={value} onChange={onChange} aria-label={label} />
      {showName ? (
        <span className="text-[length:var(--text-caption)] text-[var(--color-text-faint)]">
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
      className="inline-block h-[var(--space-3)] w-[var(--space-3)] shrink-0"
      style={{ background: props.color }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Add-tag dialog - the screen's one primary action                          */
/* -------------------------------------------------------------------------- */

function AddTagDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onCreate: (input: { name: string; color: string }) => void;
}) {
  const { open, onOpenChange, pending, onCreate } = props;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setColor(DEFAULT_COLOR);
      setNameError(null);
    }
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setNameError("Give this tag a name.");
      return;
    }
    setNameError(null);
    onCreate({ name: trimmedName, color });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add tag</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-4)]">
          <Field label="Name" htmlFor="new-tag-name" error={nameError ?? undefined}>
            <Input
              id="new-tag-name"
              data-testid="tag-name-input"
              placeholder="Repeat customer"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>
          <LabelledColorPicker label="Colour" value={color} onChange={setColor} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} data-testid="tag-add">
              Add tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
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
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function TagRow(props: {
  tag: TagRecord;
  count: number;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { tag, count, last, onEdit, onDelete } = props;
  return (
    <CardRow
      className={cn("items-center gap-[var(--space-4)]", last && "border-b-0")}
      data-testid="tag-row"
      data-tag-name={tag.name}
    >
      <span className="flex min-w-0 items-center gap-[var(--space-2)]">
        <TagSwatch color={tag.color} />
        <span
          className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          title={tag.name}
        >
          {tag.name}
        </span>
      </span>
      <span className="flex flex-none items-center gap-[var(--space-3)]">
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {count === 0 ? "Not used yet" : `On ${count} ${count === 1 ? "record" : "records"}`}
        </span>
        <span className="flex items-center gap-[var(--space-1)]">
          <IconButton
            label={`Rename or recolour "${tag.name}"`}
            size="sm"
            onClick={onEdit}
          >
            <Pencil size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
          </IconButton>
          <IconButton
            label={`Delete "${tag.name}"`}
            size="sm"
            variant="danger"
            data-testid="tag-delete"
            onClick={onDelete}
          >
            <Trash2 size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />
          </IconButton>
        </span>
      </span>
    </CardRow>
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

  const [addOpen, setAddOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagRecord | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null);

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: qk.tags() });
    await queryClient.invalidateQueries({ queryKey: settingsKeys.tagCounts() });
  }

  const createMutation = useMutation({
    mutationFn: (input: { name: string; color: string }) => tagsRepo.create(input),
    onSuccess: async () => {
      await invalidate();
      setAddOpen(false);
    },
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

  const addTagButton = (
    <Button
      variant="primary"
      onClick={() => setAddOpen(true)}
      data-testid="tag-add-open"
    >
      Add tag
    </Button>
  );

  return (
    <SettingsScreenFrame
      title="Tags"
      subtitle="The labels you put on people, companies and deals."
      testId="settings-tags"
      actions={tags.length > 0 ? addTagButton : undefined}
    >
      {tagsQuery.isLoading ? (
        <SettingsLoading>Reading the tag list…</SettingsLoading>
      ) : tags.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description="Add one and it shows up everywhere you can tag a contact, a company or a deal."
          action={addTagButton}
        />
      ) : (
        <SettingsGroup label="All tags">
          {tags.map((tag, index) => (
            <TagRow
              key={tag.id}
              tag={tag}
              count={countByTagId.get(tag.id) ?? 0}
              last={index === tags.length - 1}
              onEdit={() => setEditingTag(tag)}
              onDelete={() => setDeletingTag(tag)}
            />
          ))}
        </SettingsGroup>
      )}

      <AddTagDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={createMutation.isPending}
        onCreate={(input) => createMutation.mutate(input)}
      />

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
