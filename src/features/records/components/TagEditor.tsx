/**
 * Tags on a record. Typing a name that does not exist creates it, because
 * making the owner go to Settings first to invent a word he already typed is
 * the kind of friction this product exists to remove.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge, Button, IconButton, Input } from "@/ui";
import * as tagsRepo from "@/db/repos/tags";
import type { TaggedEntityType } from "@/db/repos/tags";
import { useEntityTags } from "@/features/records/lib/hooks";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

export function TagEditor(props: {
  entityType: TaggedEntityType;
  entityId: string;
}) {
  const { entityType, entityId } = props;
  const { data: tags } = useEntityTags(entityType, entityId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const wanted = name.trim();
    if (wanted.length === 0) return;
    setBusy(true);
    try {
      // Two sequential repository calls, never nested: the write lock does
      // not reenter.
      const tag = await tagsRepo.ensure(wanted);
      await tagsRepo.attach(tag.id, entityType, entityId);
      await invalidateRecords();
      setName("");
      setAdding(false);
    } catch (err) {
      reportError(err, "That tag did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(tagId: string) {
    try {
      await tagsRepo.detach(tagId, entityType, entityId);
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That tag did not come off.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      {(tags ?? []).map((tag) => (
        <span key={tag.id} className="inline-flex items-center">
          <Badge dotColor={tag.color}>
            <span className="max-w-[180px] truncate" title={tag.name}>
              {tag.name}
            </span>
            <IconButton
              label={`Remove tag ${tag.name}`}
              size="sm"
              className="ml-[var(--space-1)] h-[var(--space-5)] w-[var(--space-5)]"
              icon={<X size={12} aria-hidden="true" />}
              onClick={() => void remove(tag.id)}
            />
          </Badge>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-[var(--space-2)]">
          <label htmlFor={`tag-${entityId}`} className="sr-only">
            New tag
          </label>
          <Input
            id={`tag-${entityId}`}
            autoFocus
            value={name}
            placeholder="Tag name"
            className="w-[180px]"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setAdding(false);
                setName("");
              }
            }}
          />
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void add()}>
            Add tag
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Plus size={16} aria-hidden="true" />}
          onClick={() => setAdding(true)}
        >
          {(tags ?? []).length === 0 ? "Add a tag" : "Add"}
        </Button>
      )}
    </div>
  );
}
