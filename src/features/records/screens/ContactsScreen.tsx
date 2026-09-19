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
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Search, Users } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Select,
  VirtualList,
} from "@/ui";
import { contactName, type Contact } from "@/db/repos/contacts";
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
  const [search, setSearch] = useState(FILTER_DEFAULTS.search);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [tagId, setTagId] = useState(FILTER_DEFAULTS.tagId);
  const [sourceId, setSourceId] = useState(FILTER_DEFAULTS.sourceId);
  const [showArchived, setShowArchived] = useState(FILTER_DEFAULTS.showArchived);
  const [creating, setCreating] = useState(false);

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
              iconLeft={<Plus size={20} aria-hidden="true" />}
              className="min-h-[44px]"
              onClick={() => setCreating(true)}
            >
              New contact
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-[var(--space-3)] py-[var(--space-4)]">
        <div className="min-w-[260px] flex-1">
          <label
            htmlFor="contact-search"
            className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
          >
            Search
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
            />
            <Input
              id="contact-search"
              value={search}
              placeholder="Name or company"
              className="pl-[var(--space-8)]"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="w-[190px]">
          <label
            htmlFor="contact-sort"
            className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
          >
            Sort
          </label>
          <Select id="contact-sort" ariaLabel="Sort" value={sort} options={SORTS} onValueChange={setSort} />
        </div>

        <div className="w-[170px]">
          <label
            htmlFor="contact-tag"
            className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
          >
            Tag
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
          <label
            htmlFor="contact-source"
            className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
          >
            Source
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

        <label className="flex min-h-[44px] items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          <Checkbox
            checked={showArchived}
            onCheckedChange={setShowArchived}
            ariaLabel="Show archived contacts"
          />
          Archived
        </label>
      </div>

      {rows.length === 0 && !isLoading ? (
        filtered ? (
          <EmptyState
            icon={<Search size={24} aria-hidden="true" />}
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
            icon={<Users size={24} aria-hidden="true" />}
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
        <div className="min-h-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <VirtualList
            items={rows}
            estimateSize={68}
            ariaLabel="Contacts"
            className="h-full max-h-[calc(100vh-280px)]"
            getKey={(contact) => contact.id}
            renderRow={(contact) => (
              <ContactRow
                contact={contact}
                tagNames={(tagIndex?.get(contact.id) ?? []).map((tag) => tag.name)}
                onOpen={() => navigate(`/contacts/${contact.id}`)}
              />
            )}
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

function ContactRow(props: { contact: Contact; tagNames: string[]; onOpen: () => void }) {
  const { contact, tagNames, onOpen } = props;
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
        "flex min-h-[68px] w-full cursor-pointer items-center gap-[var(--space-4)]",
        "border-b border-[var(--color-border)] px-[var(--space-4)]",
        "hover:bg-[var(--color-hover)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[length:var(--text-lg)] font-medium text-[var(--color-text)]"
          title={name}
        >
          {name}
        </div>
        <div
          className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          title={contact.companyName ?? ""}
        >
          {contact.companyName ?? "No company"}
        </div>
      </div>

      <div className="hidden w-[180px] shrink-0 items-center gap-[var(--space-1)] md:flex">
        {tagNames.slice(0, 2).map((tag) => (
          <Badge key={tag}>
            <span className="max-w-[70px] truncate" title={tag}>
              {tag}
            </span>
          </Badge>
        ))}
        {tagNames.length > 2 ? <Badge>+{tagNames.length - 2}</Badge> : null}
      </div>

      <Link
        href={`/contacts/${contact.id}`}
        onClick={(event) => event.stopPropagation()}
        className="shrink-0 text-[length:var(--text-sm)] text-[var(--color-text-muted)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        Open
      </Link>
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
