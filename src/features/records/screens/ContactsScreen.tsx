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
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Switch,
  VirtualList,
} from "@/ui";
import { contactName, type Contact } from "@/db/repos/contacts";
import * as settingsRepo from "@/db/repos/settings";
import { qk } from "@/app/queryClient";
import {
  useContacts,
  useDebounced,
  useEntityTagIndex,
  useSources,
  useTags,
} from "@/features/records/lib/hooks";
import { NewContactDialog } from "@/features/records/components/NewContactDialog";
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
  | { kind: "contact"; key: string; contact: Contact };

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

  const filtered = debouncedSearch.trim().length > 0 || tagId !== ALL || sourceId !== ALL;
  const total = data?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={showArchived ? "Archived contacts" : "Contacts"}
        subtitle={
          isLoading
            ? "Loading"
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

      <div className="flex flex-wrap items-center gap-[var(--space-3)] py-[var(--space-4)]">
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
              showArchived
                ? "Contacts you archive stay here until you restore them."
                : "Add the person you spoke to this morning, or bring a spreadsheet in from Import."
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* The column strip: the one uppercase type in the product, which is
              how a native list view labels a column (DESIGN.md §4). */}
          <div className="section-label flex h-[var(--control-h)] w-full flex-none items-center gap-[var(--space-4)] border-b border-[var(--color-border)] px-[var(--space-4)]" aria-hidden="true">
            <span className="min-w-0 flex-1">Name</span>
            {showAs === "name" ? <span className="w-[200px] flex-none">Company</span> : null}
            <span className="hidden w-[180px] flex-none text-right md:block">Tags</span>
          </div>
          <VirtualList
            items={listRows}
            ariaLabel="Contacts"
            className="min-h-0 flex-1 max-h-[calc(100vh-280px)]"
            getKey={(row) => row.key}
            renderRow={(row) =>
              row.kind === "header" ? (
                <GroupHeaderRow label={row.label} />
              ) : (
                <ContactRow
                  contact={row.contact}
                  showCompany={showAs === "name"}
                  tagNames={(tagIndex?.get(row.contact.id) ?? []).map((tag) => tag.name)}
                  onOpen={() => navigate(`/contacts/${row.contact.id}`)}
                />
              )
            }
          />
        </div>
      )}

      <NewContactDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => navigate(`/contacts/${id}`)}
      />
    </div>
  );
}

function ContactRow(props: {
  contact: Contact;
  tagNames: string[];
  showCompany: boolean;
  onOpen: () => void;
}) {
  const { contact, tagNames, showCompany, onOpen } = props;
  const name = contactName(contact);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={[
        "flex min-h-[var(--row-h)] w-full cursor-default items-center gap-[var(--space-4)]",
        "border-b border-[var(--color-border)] px-[var(--space-4)]",
        "hover:bg-[var(--color-hover)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]",
      ].join(" ")}
    >
      <div
        className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
        title={name}
      >
        {name}
      </div>
      {showCompany ? (
        <div
          className="w-[200px] shrink-0 truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          title={contact.companyName ?? ""}
        >
          {contact.companyName ?? NO_COMPANY_LABEL}
        </div>
      ) : null}

      <div className="hidden w-[180px] shrink-0 items-center justify-end gap-[var(--space-1)] md:flex">
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

function sortContacts(rows: Contact[], sort: string): Contact[] {
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

function contactRow(contact: Contact): ListRow {
  return { kind: "contact", key: contact.id, contact };
}

/**
 * "By company": one header per company, sorted by company name then contact
 * name, with contacts that have no company grouped last under "No company"
 * regardless of where that label would otherwise sort alphabetically.
 */
function groupByCompany(contacts: Contact[]): ListRow[] {
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
        label: contact.companyName ?? NO_COMPANY_LABEL,
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
