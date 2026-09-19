/**
 * The two controls a list screen adds to get saved views: a "Views" popover to
 * pick one, and "Save view" to keep the filters that are on screen now.
 *
 * It exists so Contacts, Companies, the deals list and Data's duplicates list
 * all get the same affordance in the same place, rather than four hand-rolled
 * popovers. The screen still owns its filter state and is still the only thing
 * that turns a `ViewQuery` into a repository call — see `screenState.ts` for
 * the two functions that do the translating.
 */
import { Bookmark } from "@/ui/icons";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/ui";
import type { SavedView } from "@/db/repos/savedViews";
import { SaveViewPopover } from "@/features/today/views/SaveViewPopover";
import { ViewPicker } from "@/features/today/views/ViewPicker";
import type { ViewEntityType, ViewQuery } from "@/features/today/views/types";

export type ViewsToolbarProps = {
  entityType: ViewEntityType;
  /** The query the screen's filters describe right now. */
  current: ViewQuery;
  /** Called with the picked view's query, or the empty query for "All". */
  onPick: (query: ViewQuery, view: SavedView | null) => void;
};

export function ViewsToolbar({ entityType, current, onPick }: ViewsToolbarProps) {
  return (
    <div className="flex items-end gap-[var(--space-2)]">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            iconLeft={<Bookmark size={16} weight="bold" aria-hidden="true" />}
          >
            Views
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[300px]">
          <ViewPicker entityType={entityType} current={current} onPick={onPick} />
        </PopoverContent>
      </Popover>

      <SaveViewPopover
        entityType={entityType}
        current={current}
        trigger={<Button variant="secondary">Save view</Button>}
      />
    </div>
  );
}
