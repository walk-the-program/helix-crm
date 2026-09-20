/**
 * The contacts list: virtualised, searched as you type, sorted and filtered by
 * tag and source. Ten thousand rows scroll on a laptop because only the
 * visible ones are in the DOM (`VirtualList`).
 *
 * Saved views (wave 3): the filter row is the whole of this screen's state, so
 * `queryFromState` turns it into a `ViewQuery` and `stateFromQuery` reads one
 * back. Picking a view writes the controls; it does not run a query of its
 * own, so everything below this point is unchanged. A pinned view is a link in
 * the sidebar's Views group, and it arrives here as `?view=<id>`, which
 * `useSavedViews` reads — hence the effect that applies the active view once
 * the row has loaded.
 *
 * "Show as" and "Hide contacts without a name" are display preferences, not
 * saved-view state — a saved view is a named filter set the owner explicitly
 * saves, and these two persist the moment they are touched, workspace-wide.
 * They live in `settings.ts` as `contacts.showAs` / `contacts.hideUnnamed`.
 * Hiding unnamed contacts is done in SQL (`ContactFilter.hasName`), not
 * filtered out here in JS, so the header count and the virtualised list agree.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buildings, CaretDown, DownloadSimple, Plus, Tag, Trash } from "@/ui/icons";
import {
  Badge,
  BulkBar,
  Button,
  Checkbox,
  ColumnHeaderCell,
  Combobox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Switch,
  toast,
  VirtualList,
  type ComboboxItem,
  type RowNavProps,
  type SortDirection,
} from "@/ui";
import { focusRingInset } from "@/ui/styles";
import { cn } from "@/ui/cn";
import { contactName, type ContactListRow } from "@/db/repos/contacts";
import * as settingsRepo from "@/db/repos/settings";
import * as companiesRepo from "@/db/repos/companies";
import * as bulkRepo from "@/db/repos/bulk";
import { formatPhone } from "@/lib/phone";
import { oneTap } from "@/lib/actions";
import { useSelection } from "@/lib/selection";
import { todayLocal } from "@/lib/dates";
import { qk } from "@/app/queryClient";
import { pushUndo } from "@/app/undo";
import { undoBatch } from "@/db/changeLog";
import { pickSavePath, writeTextFileAt } from "@/features/data/lib/fsBridge";
import { toCsvFromObjects, type CsvCell } from "@/features/data/lib/exportCsv";
import {
  useContacts,
  useDebounced,
  useEntityTagIndex,
  useSources,
  useTags,
} from "@/features/records/lib/hooks";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { HelpLink } from "@/features/help";
import { NewContactDialog } from "@/features/records/components/NewContactDialog";
import { trashSuffix, TrashMark } from "@/features/records/components/RecordChip";
import {
  queryFromState,
  sortIdOf,
  stateFromQuery,
  useSavedViews,
  ViewsToolbar,
  type ViewQuery,
} from "@/features/today/views";

const SHOW_AS_OPTIONS = [
  { value: "name", label: "By name" },
  { value: "company", label: "By company" },
];

const NO_COMPANY_LABEL = "No company";

/** A flattened row for the virtualised list: either a group header or a contact. */
type ListRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "contact"; key: string; contact: ContactListRow };

const SORTS = [
  { value: "name-asc", label: "Name A to Z" },
  { value: "name-desc", label: "Name Z to A" },
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Recently changed" },
];

const ALL = "__all__";

const DEFAULT_SORT = "name-asc";

/** The screen's filter state, and what "nothing filtered" looks like. */
const FILTER_DEFAULTS = {
  search: "",
  tagId: ALL,
  sourceId: ALL,
  showArchived: false,
};

export function ContactsScreen() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(FILTER_DEFAULTS.search);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [tagId, setTagId] = useState(FILTER_DEFAULTS.tagId);
  const [sourceId, setSourceId] = useState(FILTER_DEFAULTS.sourceId);
  const [showArchived, setShowArchived] = useState(FILTER_DEFAULTS.showArchived);
  const [creating, setCreating] = useState(false);

  // "Show as" and "Hide contacts without a name": workspace settings, not
  // component state — they read once from `settings.ts` and every change
  // writes straight back, the same pattern VocabularyScreen uses.
  const showAsQuery = useQuery({
    queryKey: qk.setting("contacts.showAs"),
    queryFn: () => settingsRepo.get("contacts.showAs"),
  });
  const hideUnnamedQuery = useQuery({
    queryKey: qk.setting("contacts.hideUnnamed"),
    queryFn: () => settingsRepo.get("contacts.hideUnnamed"),
  });
  const [showAs, setShowAsState] = useState(showAsQuery.data ?? "name");
  const [hideUnnamed, setHideUnnamedState] = useState(hideUnnamedQuery.data ?? false);
  useEffect(() => {
    if (showAsQuery.data) setShowAsState(showAsQuery.data);
  }, [showAsQuery.data]);
  useEffect(() => {
    if (hideUnnamedQuery.data !== undefined) setHideUnnamedState(hideUnnamedQuery.data);
  }, [hideUnnamedQuery.data]);

  const showAsMutation = useMutation({
    mutationFn: (value: "name" | "company") => settingsRepo.set("contacts.showAs", value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.setting("contacts.showAs") });
    },
  });
  const hideUnnamedMutation = useMutation({
    mutationFn: (value: boolean) => settingsRepo.set("contacts.hideUnnamed", value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.setting("contacts.hideUnnamed") });
    },
  });

  function setShowAs(value: "name" | "company") {
    setShowAsState(value);
    showAsMutation.mutate(value);
  }
  function setHideUnnamed(value: boolean) {
    setHideUnnamedState(value);
    hideUnnamedMutation.mutate(value);
  }

  const currentView: ViewQuery = useMemo(
    () => queryFromState({ search, tagId, sourceId, showArchived }, FILTER_DEFAULTS, sort),
    [search, tagId, sourceId, showArchived, sort],
  );

  function applyView(query: ViewQuery | null) {
    const next = stateFromQuery(query, FILTER_DEFAULTS);
    setSearch(next.search);
    setTagId(next.tagId);
    setSourceId(next.sourceId);
    setShowArchived(next.showArchived);
    setSort(sortIdOf(query, DEFAULT_SORT));
  }

  // A link from the sidebar's Views group lands here with `?view=<id>` before
  // the row itself has been read, so apply it when it arrives — once per view.
  const { activeId, activeQuery } = useSavedViews("contact", currentView);
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId || !activeQuery || appliedViewId === activeId) return;
    setAppliedViewId(activeId);
    applyView(activeQuery);
  }, [activeId, activeQuery, appliedViewId]);

  const debouncedSearch = useDebounced(search, 200);
  const { data: tags } = useTags();
  const { data: sources } = useSources();
  const { data: tagIndex } = useEntityTagIndex("contact");

  const { data, isLoading } = useContacts(
    {
      search: debouncedSearch.trim() || undefined,
      sourceId: sourceId === ALL ? undefined : sourceId,
      onlyDeleted: showArchived ? true : undefined,
      hasName: hideUnnamed ? true : undefined,
    },
    20000,
  );

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (tagId !== ALL) {
      list = list.filter((contact) =>
        (tagIndex?.get(contact.id) ?? []).some((tag) => tag.id === tagId),
      );
    }
    return sortContacts(list, sort);
  }, [data, sort, tagId, tagIndex]);

  const listRows = useMemo(
    () => (showAs === "company" ? groupByCompany(rows) : rows.map(contactRow)),
    [rows, showAs],
  );

  // Selection is keyed by id, in the order the list actually renders in
  // (flat or grouped by company), so a shift-click range means what it looks
  // like on screen either way. `useSelection` reconciles on its own whenever
  // this array's *content* changes — a refilter, a resort, a query refetch —
  // so scrolling the virtualised list below (which never touches this array)
  // can never drop or corrupt the selection.
  const orderedContactIds = useMemo(
    () => listRows.filter((row): row is Extract<ListRow, { kind: "contact" }> => row.kind === "contact").map((row) => row.contact.id),
    [listRows],
  );
  const selection = useSelection(orderedContactIds);
  const [settingCompany, setSettingCompany] = useState(false);
  const [confirmingBulkTrash, setConfirmingBulkTrash] = useState(false);

  // Escape clears the selection. This is additional to, and does not touch,
  // the roving-tabindex arrow navigation VirtualList installs per row
  // (useRovingRowNav only answers Arrow/Home/End/Enter/Space) — Escape was
  // never one of its keys.
  useEffect(() => {
    if (selection.count === 0) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") selection.clear();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.count]);

  async function afterBulkAction(
    result: { batchId: string; count: number },
    undoLabel: string,
    doneSentence: string,
  ): Promise<void> {
    pushUndo({ batchId: result.batchId, label: undoLabel });
    toast.undo(doneSentence, () => {
      void (async () => {
        try {
          await undoBatch(result.batchId);
          await invalidateRecords();
          toast.success(`Undone: ${undoLabel}`);
        } catch (err) {
          reportError(err, "Could not undo that.");
        }
      })();
    });
    selection.clear();
    await invalidateRecords();
  }

  async function handleAddTag(tagId: string, tagName: string): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.addTagToContacts(ids, tagId);
      const word = ids.length === 1 ? "person" : "people";
      await afterBulkAction(
        result,
        `added the tag ${tagName} to ${ids.length} ${word}`,
        `Added the tag ${tagName} to ${ids.length} ${word}`,
      );
    } catch (err) {
      reportError(err, "That tag could not be added.");
    }
  }

  async function handleRemoveTag(tagId: string, tagName: string): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.removeTagFromContacts(ids, tagId);
      const word = ids.length === 1 ? "person" : "people";
      await afterBulkAction(
        result,
        `removed the tag ${tagName} from ${ids.length} ${word}`,
        `Removed the tag ${tagName} from ${ids.length} ${word}`,
      );
    } catch (err) {
      reportError(err, "That tag could not be removed.");
    }
  }

  async function handleSetCompany(companyId: string | null, companyLabel: string | null): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.setContactsCompany(ids, companyId);
      const word = ids.length === 1 ? "person" : "people";
      const phrase = companyLabel
        ? `set the company to ${companyLabel} on ${ids.length} ${word}`
        : `cleared the company on ${ids.length} ${word}`;
      await afterBulkAction(
        result,
        phrase,
        `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`,
      );
    } catch (err) {
      reportError(err, "That change did not save.");
    }
  }

  async function handleBulkTrash(): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.trashContacts(ids);
      const word = ids.length === 1 ? "contact" : "contacts";
      pushUndo({ batchId: result.batchId, label: `moved ${ids.length} ${word} to trash` });
      toast.undo(`Moved ${ids.length} ${word} to trash`, () => {
        void (async () => {
          try {
            await undoBatch(result.batchId);
            await invalidateRecords();
            toast.success(`Undone: moved ${ids.length} ${word} to trash`);
          } catch (err) {
            reportError(err, "Could not undo that.");
          }
        })();
      });
      selection.clear();
      await invalidateRecords();
    } catch (err) {
      reportError(err, "Those contacts could not be moved to trash.");
    }
  }

  /** The same columns the list shows, for exactly the ticked rows. */
  async function handleExportSelected(): Promise<void> {
    const ids = new Set(selection.selectedIds);
    const selectedRows = rows.filter((contact) => ids.has(contact.id));
    type ExportRow = Record<string, CsvCell>;
    const headers = [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "company", label: "Company" },
      { key: "nextStep", label: "Next step" },
      { key: "tags", label: "Tags" },
    ];
    const exportRows: ExportRow[] = selectedRows.map((contact) => ({
      name: contactName(contact),
      phone: contact.primaryPhoneRaw ?? "",
      company: contact.companyName ?? "",
      nextStep: contact.nextTaskTitle ?? "",
      tags: (tagIndex?.get(contact.id) ?? []).map((tag) => tag.name).join("; "),
    }));
    const csv = toCsvFromObjects<ExportRow>(headers, exportRows);
    try {
      const path = await pickSavePath({
        title: "Export selected contacts",
        defaultPath: `helix-contacts-selected-${todayLocal()}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path === null) return;
      await writeTextFileAt(path, csv);
      toast.success(`Exported ${selectedRows.length} contacts`);
    } catch (err) {
      reportError(err, "That export did not save.");
    }
  }

  const filtered = debouncedSearch.trim().length > 0 || tagId !== ALL || sourceId !== ALL;
  /**
   * A workspace with no contacts at all, and nothing filtered.
   *
   * It used to render the full toolbar over the empty state: a count reading
   * "0 of 0 people" and six controls for narrowing nothing. An empty state is a
   * title, one sentence and one action (phase two, direction rule 6), so the
   * controls and the count stand down until there is something to use them on.
   * A filter that matches nothing is the opposite case and keeps everything on
   * screen, because the owner needs the control that got him there.
   */
  const unused =
    !isLoading && (data?.total ?? 0) === 0 && !filtered && !showArchived;
  /**
   * A saved view can outlive the tag it filters on: `tags.softDelete` leaves
   * `tag_links` alone, so the view still applies but the tag has gone from
   * the Select and every contact falls out. The screen used to answer that
   * with a flat "Nothing matches those filters", which sends the owner
   * looking for a filter he cannot see (worker finding F-W1-2). When the
   * filter names a tag that is no longer live, say so and offer the way out.
   */
  const missingTag = tagId !== ALL && (tags ?? []).every((tag) => tag.id !== tagId);
  const total = data?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={showArchived ? "Archived contacts" : "Contacts"}
        subtitle={
          isLoading
            ? "Loading"
            : unused
              ? null
              : `${rows.length.toLocaleString()} of ${total.toLocaleString()} ${
                  total === 1 ? "person" : "people"
                }`
        }
        actions={
          <div className="flex items-end gap-[var(--space-2)]">
            <ViewsToolbar
              entityType="contact"
              current={currentView}
              onPick={(query) => applyView(query)}
            />
            <Button
              variant="primary"
              iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setCreating(true)}
            >
              New contact
            </Button>
          </div>
        }
      />

      <div
        hidden={unused}
        className="flex flex-wrap items-center gap-[var(--space-3)] py-[var(--space-4)]"
      >
        <div className="min-w-[260px] flex-1">
          <label htmlFor="contact-search" className="sr-only">
            Search contacts
          </label>
          <Input
            id="contact-search"
            search
            value={search}
            placeholder="Name or company"
            aria-label="Search contacts"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="w-[170px]">
          <label htmlFor="contact-sort" className="sr-only">
            Sort
          </label>
          <Select
            id="contact-sort"
            ariaLabel="Sort"
            value={sort}
            options={SORTS}
            onValueChange={setSort}
            disabled={showAs === "company"}
          />
        </div>

        <div className="w-[170px]">
          <label htmlFor="contact-tag" className="sr-only">
            Filter by tag
          </label>
          <Select
            id="contact-tag"
            ariaLabel="Filter by tag"
            value={tagId}
            options={[
              { value: ALL, label: "Any tag" },
              ...(tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
            ]}
            onValueChange={setTagId}
          />
        </div>

        <div className="w-[170px]">
          <label htmlFor="contact-source" className="sr-only">
            Filter by source
          </label>
          <Select
            id="contact-source"
            ariaLabel="Filter by source"
            value={sourceId}
            options={[
              { value: ALL, label: "Any source" },
              ...(sources ?? []).map((source) => ({ value: source.id, label: source.name })),
            ]}
            onValueChange={setSourceId}
          />
        </div>

        <div className="w-[140px]">
          <label htmlFor="contact-show-as" className="sr-only">
            Show as
          </label>
          <Select
            id="contact-show-as"
            ariaLabel="Show as"
            value={showAs}
            options={SHOW_AS_OPTIONS}
            onValueChange={(value) => setShowAs(value as "name" | "company")}
          />
        </div>

        <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          <Switch
            checked={hideUnnamed}
            onCheckedChange={setHideUnnamed}
            ariaLabel="Hide contacts without a name"
          />
          Hide unnamed
        </label>

        <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          <Checkbox
            checked={showArchived}
            onCheckedChange={setShowArchived}
            ariaLabel="Show archived contacts"
          />
          Archived
        </label>
      </div>

      {rows.length === 0 && !isLoading ? (
        hideUnnamed ? (
          <EmptyState
            title="Every contact here has no name"
            description="Show them again?"
            action={
              <Button variant="secondary" onClick={() => setHideUnnamed(false)}>
                Show them again
              </Button>
            }
          />
        ) : missingTag ? (
          <EmptyState
            title="That tag has been deleted"
            description="This view still filters on a tag that no longer exists, so nothing can match it. Drop the tag filter to see everyone again, or delete the view."
            action={
              <div className="flex items-center gap-[var(--space-2)]">
                <Button variant="secondary" onClick={() => setTagId(ALL)}>
                  Drop the tag filter
                </Button>
                <Button variant="secondary" onClick={() => navigate("/settings/tags")}>
                  Manage tags
                </Button>
              </div>
            }
          />
        ) : filtered ? (
          <EmptyState
            title={`Nothing matches "${search.trim() || "those filters"}"`}
            description="Clear the filters to see everyone, or add this person now."
            action={
              <div className="flex items-center gap-[var(--space-2)]">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setTagId(ALL);
                    setSourceId(ALL);
                  }}
                >
                  Clear filters
                </Button>
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  Add a contact
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            title={showArchived ? "Nothing archived" : "No contacts yet"}
            description={
              showArchived ? (
                "Contacts you archive stay here until you restore them."
              ) : (
                <>
                  Add the person you spoke to this morning, or bring a spreadsheet in from
                  Import. <HelpLink to="customers-in">How importing works</HelpLink>
                </>
              )
            }
            action={
              showArchived ? (
                <Button variant="secondary" onClick={() => setShowArchived(false)}>
                  Back to contacts
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  Add your first contact
                </Button>
              )
            }
          />
        )
      ) : (
        // No `flex-1`: the surface ends where the rows end, so a workspace with
        // four contacts does not get a bordered slab of white under them
        // (direction rule 1). `<VirtualList fit>` below measures its own height
        // against the nearest bounding ancestor rather than against this panel,
        // so nothing here is circular and a short list can no longer collapse -
        // which is what the first version of the prop got wrong.
        <div className="flex min-h-0 flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* The column strip: the one uppercase type in the product, which is
              how a native list view labels a column (DESIGN.md §4). Name is
              the only header that can sort - it is the only column the
              "Sort" Select below can also express - and clicking it drives
              that same `sort` state, so the two never disagree. Grouped "by
              company" ignores `sort` entirely (groupByCompany always sorts by
              company then name), so the header goes inert there too, exactly
              like the Select does.

              Widths narrow to what fits the owner's own scan (PLAN.md: the
              name, the money, the phone number) as the window shrinks: at
              1024px only Name, Phone and Next step show; Company returns at
              1280px and Tags at 1440px (F-LA-7, the CPO audit's dense-contacts
              screenshot). */}
          <div
            role="row"
            className="section-label flex h-[var(--control-h)] w-full flex-none items-center gap-[var(--space-4)] border-b border-[var(--color-border)] px-[var(--space-4)]"
          >
            <div className="flex w-[var(--control-h-sm)] flex-none items-center justify-center">
              <Checkbox
                checked={
                  orderedContactIds.length > 0 && selection.count === orderedContactIds.length
                    ? true
                    : selection.count > 0
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(checked) => (checked ? selection.selectAll() : selection.clear())}
                aria-label="Select every contact in this filter"
              />
            </div>
            <ColumnHeaderCell
              className="min-w-0 flex-1"
              sortable={showAs === "name"}
              sortDirection={nameSortDirection(sort)}
              onSort={() => setSort(sort === "name-asc" ? "name-desc" : "name-asc")}
            >
              Name
            </ColumnHeaderCell>
            <ColumnHeaderCell className="hidden w-[130px] flex-none lg:block">Phone</ColumnHeaderCell>
            {showAs === "name" ? (
              <ColumnHeaderCell className="hidden w-[200px] flex-none xl:block">Company</ColumnHeaderCell>
            ) : null}
            <ColumnHeaderCell className="hidden w-[220px] flex-none lg:block">Next step</ColumnHeaderCell>
            <ColumnHeaderCell align="right" className="hidden w-[180px] flex-none min-[1440px]:block">
              Tags
            </ColumnHeaderCell>
          </div>
          <VirtualList
            items={listRows}
            ariaLabel="Contacts"
            fit
            className="min-h-0 max-h-[calc(100vh-280px)]"
            getKey={(row) => row.key}
            keyboardNav={{
              isFocusable: (row) => row.kind === "contact",
              onActivate: (row) => {
                if (row.kind === "contact") navigate(`/contacts/${row.contact.id}`);
              },
            }}
            renderRow={(row, _index, nav) =>
              row.kind === "header" ? (
                <GroupHeaderRow label={row.label} />
              ) : (
                <ContactRow
                  contact={row.contact}
                  showCompany={showAs === "name"}
                  tagNames={(tagIndex?.get(row.contact.id) ?? []).map((tag) => tag.name)}
                  onOpen={() => navigate(`/contacts/${row.contact.id}`)}
                  nav={nav}
                  selected={selection.isSelected(row.contact.id)}
                  onSelectToggle={() => selection.toggle(row.contact.id)}
                  onSelectRange={() =>
                    selection.onRowClick(row.contact.id, {
                      shiftKey: true,
                      metaKey: false,
                      ctrlKey: false,
                    })
                  }
                />
              )
            }
          />

          <BulkBar count={selection.count} noun={{ one: "person", many: "people" }} onClear={selection.clear}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" iconRight={<CaretDown size={14} weight="bold" aria-hidden="true" />}>
                  <Tag size={16} weight="bold" aria-hidden="true" /> Add tag
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(tags ?? []).length === 0 ? (
                  <DropdownMenuLabel>No tags yet</DropdownMenuLabel>
                ) : (
                  (tags ?? []).map((tag) => (
                    <DropdownMenuItem key={tag.id} onSelect={() => void handleAddTag(tag.id, tag.name)}>
                      {tag.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" iconRight={<CaretDown size={14} weight="bold" aria-hidden="true" />}>
                  <Tag size={16} weight="bold" aria-hidden="true" /> Remove tag
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(tags ?? []).length === 0 ? (
                  <DropdownMenuLabel>No tags yet</DropdownMenuLabel>
                ) : (
                  (tags ?? []).map((tag) => (
                    <DropdownMenuItem key={tag.id} onSelect={() => void handleRemoveTag(tag.id, tag.name)}>
                      {tag.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Buildings size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setSettingCompany(true)}
            >
              Set company
            </Button>

            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Trash size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setConfirmingBulkTrash(true)}
            >
              Move to trash
            </Button>

            <Button
              variant="secondary"
              size="sm"
              iconLeft={<DownloadSimple size={16} weight="bold" aria-hidden="true" />}
              onClick={() => void handleExportSelected()}
            >
              Export selected
            </Button>
          </BulkBar>
        </div>
      )}

      <NewContactDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => navigate(`/contacts/${id}`)}
      />

      <SetCompanyDialog
        open={settingCompany}
        onOpenChange={setSettingCompany}
        count={selection.count}
        onConfirm={handleSetCompany}
      />

      <ConfirmDialog
        open={confirmingBulkTrash}
        onOpenChange={setConfirmingBulkTrash}
        title={`Move ${selection.count} ${selection.count === 1 ? "contact" : "contacts"} to trash?`}
        description="They move to Trash and can be restored for 30 days."
        confirmLabel="Move to trash"
        destructive
        onConfirm={handleBulkTrash}
      />
    </div>
  );
}

/** The "Set company" bulk action: a Combobox over the workspace's companies,
 *  never a Select — DESIGN.md forbids a Select for picking a record. */
function SetCompanyDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (companyId: string | null, companyLabel: string | null) => Promise<void>;
}) {
  const { open, onOpenChange, count, onConfirm } = props;
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyItem, setCompanyItem] = useState<ComboboxItem | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCompanyId(null);
      setCompanyItem(null);
    }
  }, [open]);

  async function search(query: string): Promise<ComboboxItem[]> {
    const rows = await companiesRepo.search(query);
    return rows.map((row) => ({ id: row.id, label: row.label, ...(row.detail ? { detail: row.detail } : {}) }));
  }

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(companyId, companyItem?.label ?? null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set company for {count} {count === 1 ? "contact" : "contacts"}?</DialogTitle>
        </DialogHeader>
        <Combobox
          aria-label="Company"
          value={companyId}
          selectedItem={companyItem}
          items={search}
          clearable
          placeholder="Search companies"
          emptyText="No company matches"
          onChange={(id, item) => {
            setCompanyId(id);
            setCompanyItem(item ?? null);
          }}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={() => void confirm()}>
            Set company
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An em dash for a cell with nothing to show — never a sentence like "No
 *  phone" or "No next step", which reads as an error at 40px rows scanned in
 *  bulk. */
const EMPTY_CELL = "—";

function ContactRow(props: {
  contact: ContactListRow;
  tagNames: string[];
  showCompany: boolean;
  onOpen: () => void;
  /** Roving-tabindex + arrow-key props from VirtualList's `keyboardNav`
   *  (apple-hig-review.md finding 6). Falls back to the row's own Enter/Space
   *  handling so ContactRow still works stand-alone (gallery specimens,
   *  tests). */
  nav?: RowNavProps;
  /** Bulk selection (LR-PX-C): whether this row's checkbox is ticked, plain
   *  toggle for a bare or Cmd/Ctrl click, and the shift-click range. All
   *  optional so ContactRow still works stand-alone. */
  selected?: boolean;
  onSelectToggle?: () => void;
  onSelectRange?: () => void;
}) {
  const { contact, tagNames, showCompany, onOpen, nav, selected, onSelectToggle, onSelectRange } = props;
  const name = contactName(contact);
  const shiftHeldRef = useRef(false);

  // Two handlers, deliberately on two phases. `onCheckedChange` gets no
  // event, so the shift modifier has to be read off the native click and
  // stashed in a ref for it to see — but Radix's own click handler (which
  // calls `onCheckedChange`) fires on the checkbox button itself, and a
  // bubble-phase listener on this wrapper runs AFTER that, which reads last
  // click's value one click late. The CAPTURE phase runs before the target's
  // own handlers, so recording the modifier there is what makes it current
  // by the time `onCheckedChange` reads it. Stopping the row's onClick
  // (`onOpen`) still has to happen on the bubble, once the checkbox itself
  // has been given the chance to react to the click.
  function handleCheckboxClickCapture(event: MouseEvent<HTMLElement>) {
    shiftHeldRef.current = event.shiftKey;
  }

  function handleCheckboxClick(event: MouseEvent<HTMLElement>) {
    // The checkbox's own gesture, never the row's: it must not also open the
    // record.
    event.stopPropagation();
  }

  function handleCheckedChange() {
    if (shiftHeldRef.current && onSelectRange) onSelectRange();
    else onSelectToggle?.();
  }
  const rowNav: {
    tabIndex: 0 | -1;
    onFocus?: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    "data-row-focus"?: "true";
  } = nav ?? {
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
  };

  const phoneDisplay = contact.primaryPhoneRaw
    ? formatPhone(contact.primaryPhoneRaw) || contact.primaryPhoneRaw
    : null;

  function handleCallClick(event: MouseEvent<HTMLButtonElement>) {
    // The one-tap call is the whole reason this column exists (PLAN.md: he
    // scans for the name, the money and the phone number). It must never
    // also open the record - the click is the call, not a row selection.
    event.stopPropagation();
    if (!phoneDisplay) return;
    void oneTap(
      "call",
      contact.primaryPhoneE164 ?? contact.primaryPhoneRaw ?? "",
      { contactId: contact.id },
      { label: phoneDisplay },
    );
  }

  const nextStepLabel = contact.nextTaskTitle
    ? `${contact.nextTaskTitle} · ${dueLabel({
        id: contact.id,
        dueOn: contact.nextTaskDueOn,
        dueAt: contact.nextTaskDueAt,
        doneAt: null,
      })}`
    : null;

  // An absent company is an absent value, not a fact about the person. It used
  // to print "No company" in the same ink as a real company name, so a list of
  // sole traders read as a column of content saying nothing (phase two,
  // direction rule 1). The em dash the Next step column already uses is what
  // "nothing here" looks like in this product. The group heading in the "by
  // company" view keeps the words, because there it IS the heading.
  const companyLabel = contact.companyName ?? EMPTY_CELL;
  const companyTitle = contact.companyName
    ? `${contact.companyName}${trashSuffix(contact.companyDeletedAt)}`
    : NO_COMPANY_LABEL;

  return (
    <div
      role="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-[var(--row-h)] w-full cursor-default items-center gap-[var(--space-4)]",
        "border-b border-[var(--color-border)] px-[var(--space-4)]",
        // A selected row is the quiet --color-selected tint, never the
        // primary block — that belongs to the sidebar (DESIGN.md §9).
        selected ? "bg-[var(--color-selected)]" : "hover:bg-[var(--color-hover)]",
        focusRingInset,
      )}
      {...rowNav}
    >
      <div
        className="flex w-[var(--control-h-sm)] flex-none items-center justify-center"
        onClickCapture={handleCheckboxClickCapture}
        onClick={handleCheckboxClick}
      >
        <Checkbox
          checked={selected ?? false}
          onCheckedChange={handleCheckedChange}
          aria-label={`Select ${name}`}
        />
      </div>
      <div
        data-testid="contact-row-name"
        className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
        title={name}
      >
        {name}
      </div>

      <div className="hidden w-[130px] shrink-0 lg:block">
        {phoneDisplay ? (
          <button
            type="button"
            onClick={handleCallClick}
            title={`Call ${phoneDisplay}`}
            className={cn(
              "block w-full truncate text-left tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
              "hover:text-[var(--color-text)] hover:underline",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1",
            )}
          >
            {phoneDisplay}
          </button>
        ) : (
          <span className="block truncate text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
            {EMPTY_CELL}
          </span>
        )}
      </div>

      {showCompany ? (
        <div
          className={cn(
            "hidden w-[200px] shrink-0 truncate text-[length:var(--text-sm)] xl:block",
            contact.companyName
              ? "text-[var(--color-text-muted)]"
              : "text-[var(--color-text-faint)]",
          )}
          title={companyTitle}
        >
          {companyLabel}
          <TrashMark deletedAt={contact.companyDeletedAt} />
        </div>
      ) : null}

      <div className="hidden w-[220px] shrink-0 lg:block">
        {nextStepLabel ? (
          <span
            className="block truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
            title={nextStepLabel}
          >
            {nextStepLabel}
          </span>
        ) : (
          <span className="block truncate text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
            {EMPTY_CELL}
          </span>
        )}
      </div>

      <div className="hidden w-[180px] shrink-0 items-center justify-end gap-[var(--space-1)] min-[1440px]:flex">
        {tagNames.slice(0, 2).map((tag) => (
          <Badge key={tag}>
            <span className="max-w-[70px] truncate" title={tag}>
              {tag}
            </span>
          </Badge>
        ))}
        {tagNames.length > 2 ? <Badge>+{tagNames.length - 2}</Badge> : null}
      </div>
    </div>
  );
}

/** The "Name" column header's direction, or null when the list is sorted by
 *  something the header cannot express (newest/updated) - the header only
 *  ever offers the two orders the SORTS options already cover. */
function nameSortDirection(sort: string): SortDirection {
  if (sort === "name-asc") return "asc";
  if (sort === "name-desc") return "desc";
  return null;
}

function sortContacts(rows: ContactListRow[], sort: string): ContactListRow[] {
  const copy = [...rows];
  if (sort === "name-desc") {
    return copy.sort((a, b) => contactName(b).localeCompare(contactName(a)));
  }
  if (sort === "newest") {
    return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (sort === "updated") {
    return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return copy.sort((a, b) => contactName(a).localeCompare(contactName(b)));
}

function contactRow(contact: ContactListRow): ListRow {
  return { kind: "contact", key: contact.id, contact };
}

/**
 * "By company": one header per company, sorted by company name then contact
 * name, with contacts that have no company grouped last under "No company"
 * regardless of where that label would otherwise sort alphabetically. A
 * trashed company keeps its heading rather than disappearing, marked the same
 * way a row would mark it (F-LA-9).
 */
function groupByCompany(contacts: ContactListRow[]): ListRow[] {
  const withCompany = contacts.filter((c) => c.companyId);
  const withoutCompany = contacts.filter((c) => !c.companyId);

  const sortedWithCompany = [...withCompany].sort((a, b) => {
    const byCompany = (a.companyName ?? "").localeCompare(b.companyName ?? "");
    return byCompany !== 0 ? byCompany : contactName(a).localeCompare(contactName(b));
  });

  const out: ListRow[] = [];
  let currentCompanyId: string | null = null;
  for (const contact of sortedWithCompany) {
    if (contact.companyId !== currentCompanyId) {
      currentCompanyId = contact.companyId;
      out.push({
        kind: "header",
        key: `header:${contact.companyId}`,
        label: contact.companyName
          ? `${contact.companyName}${trashSuffix(contact.companyDeletedAt)}`
          : NO_COMPANY_LABEL,
      });
    }
    out.push(contactRow(contact));
  }

  if (withoutCompany.length > 0) {
    out.push({ kind: "header", key: "header:none", label: NO_COMPANY_LABEL });
    const sortedWithoutCompany = [...withoutCompany].sort((a, b) =>
      contactName(a).localeCompare(contactName(b)),
    );
    for (const contact of sortedWithoutCompany) {
      out.push(contactRow(contact));
    }
  }

  return out;
}

/**
 * The group header row: the caption style, same as the column strip above it
 * (DESIGN.md §4/§9 "the caption style for the label above a group").
 */
function GroupHeaderRow(props: { label: string }) {
  return (
    <div
      className="section-label flex h-[var(--control-h-sm)] w-full flex-none items-center border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-[var(--space-4)]"
      role="presentation"
    >
      {props.label}
    </div>
  );
}
