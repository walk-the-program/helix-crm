/**
 * "Save this filter as a view", opened from a list screen's toolbar.
 *
 * The name field always starts blank: typing a name and pressing "Save view"
 * (or Enter) always creates a new view, and never renames the one that is
 * currently active. Overwriting the active view's query is a separate,
 * explicit action — the "Update <name>" button, which only appears once a
 * view is picked and the current filters have actually drifted from it — so
 * the owner never loses a saved view's query by accident while trying to
 * save a new one under a different name.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Checkbox, Field, Input, Popover, PopoverContent, PopoverTrigger } from "@/ui";
import type { SavedView } from "@/db/repos/savedViews";
import { useSavedViews } from "@/features/today/views/useSavedViews";
import type { ViewEntityType, ViewQuery } from "@/features/today/views/types";

export type SaveViewPopoverProps = {
  entityType: ViewEntityType;
  current: ViewQuery;
  trigger?: ReactNode;
  onSaved?: (view: SavedView) => void;
};

export function SaveViewPopover(props: SaveViewPopoverProps) {
  const { entityType, current, trigger, onSaved } = props;
  const { active, dirty, saveAs, saveOver } = useSavedViews(entityType, current);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const offerUpdate = active !== null && dirty;

  function reset() {
    setName("");
    setPinned(false);
  }

  async function handleSaveAs() {
    if (trimmedName === "" || saving) return;
    setSaving(true);
    try {
      const view = await saveAs(trimmedName, { pinned });
      onSaved?.(view);
      setOpen(false);
      reset();
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!active || saving) return;
    setSaving(true);
    try {
      await saveOver(active.id);
      onSaved?.(active);
      setOpen(false);
      reset();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? <Button variant="secondary">Save view</Button>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px]">
        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="Name" htmlFor="save-view-name">
            <Input
              id="save-view-name"
              className="min-h-[44px]"
              placeholder="e.g. Overdue, high value"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSaveAs();
                }
              }}
              autoFocus
            />
          </Field>

          <label className="flex min-h-[44px] items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text)]">
            <Checkbox checked={pinned} onCheckedChange={setPinned} />
            Also pin to the sidebar
          </label>

          <div className="flex flex-col gap-[var(--space-2)]">
            <Button
              variant="primary"
              className="min-h-[44px]"
              disabled={trimmedName === ""}
              loading={saving}
              onClick={() => void handleSaveAs()}
            >
              Save view
            </Button>
            {offerUpdate && active ? (
              <Button
                variant="secondary"
                className="min-h-[44px]"
                loading={saving}
                onClick={() => void handleUpdate()}
              >
                {`Update ${active.name}`}
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
