/**
 * The companies list. Same shape as contacts — search, sort, tag and source
 * filters, virtualised rows — because the owner should not have to learn two
 * lists.
 */
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  Checkbox,
  ColumnHeaderCell,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FormRow,
  Input,
  PageHeader,
  Select,
  VirtualList,
  type RowNavProps,
  type SortDirection,
} from "@/ui";
import { focusRingInset } from "@/ui/styles";
import { cn } from "@/ui/cn";
import * as companiesRepo from "@/db/repos/companies";
import type { CompanyListRow } from "@/db/repos/companies";
import { formatPhone } from "@/lib/phone";
import { formatMoneyTrim } from "@/lib/money";
import { useVocabulary } from "@/app/vocabulary";
import {
  useCompanies,
  useDebounced,
  useEntityTagIndex,
  useSources,
  useTags,
} from "@/features/records/lib/hooks";
import {
  invalidateRecords,
  newBatchId,
  offerUndoCreate,
  reportError,
} from "@/features/records/lib/mutations";
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

export function CompaniesScreen() {
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
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
  const { activeId, activeQuery } = useSavedViews("company", currentView);
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId || !activeQuery || appliedViewId === activeId) return;
    setAppliedViewId(activeId);
    applyView(activeQuery);
  }, [activeId, activeQuery, appliedViewId]);

  const debouncedSearch = useDebounced(search, 200);
  const { data: tags } = useTags();
  const { data: sources } = useSources();
  const { data: tagIndex } = useEntityTagIndex("company");

  const { data, isLoading } = useCompanies(
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
      list = list.filter((company) =>
        (tagIndex?.get(company.id) ?? []).some((tag) => tag.id === tagId),
      );
    }
    const copy = [...list];
    if (sort === "name-desc") return copy.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === "newest") return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, sort, tagId, tagIndex]);

  const filtered = debouncedSearch.trim().length > 0 || tagId !== ALL || sourceId !== ALL;
  // Nothing to filter and nothing filtered: the toolbar and the count stand
  // down so the empty state is a title, a sentence and one action, not six
  // controls for narrowing nothing (phase two, direction rule 6).
  const unused = !isLoading && rows.length === 0 && !filtered && !showArchived;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={showArchived ? "Archived companies" : "Companies"}
        subtitle={
          isLoading
            ? "Loading"
            : unused
              ? null
              : `${rows.length.toLocaleString()} ${rows.length === 1 ? "company" : "companies"}`
        }
        actions={
          <div className="flex items-end gap-[var(--space-2)]">
            <ViewsToolbar
              entityType="company"
              current={currentView}
              onPick={(query) => applyView(query)}
            />
            <Button
              variant="primary"
              iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setCreating(true)}
            >
              New company
            </Button>
          </div>
        }
      />

      <div
        hidden={unused}
        className="flex flex-wrap items-center gap-[var(--space-3)] py-[var(--space-4)]"
      >
        <div className="min-w-[260px] flex-1">
          <label htmlFor="company-search" className="sr-only">
            Search companies
          </label>
          <Input
            id="company-search"
            search
            value={search}
            placeholder="Company name"
            aria-label="Search companies"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="w-[190px]">
          <label htmlFor="company-sort" className="sr-only">
            Sort
          </label>
          <Select id="company-sort" ariaLabel="Sort" value={sort} options={SORTS} onValueChange={setSort} />
        </div>

        <div className="w-[170px]">
          <label htmlFor="company-tag" className="sr-only">
            Filter by tag
          </label>
          <Select
            id="company-tag"
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
          <label htmlFor="company-source" className="sr-only">
            Filter by source
          </label>
          <Select
            id="company-source"
            ariaLabel="Filter by source"
            value={sourceId}
            options={[
              { value: ALL, label: "Any source" },
              ...(sources ?? []).map((source) => ({ value: source.id, label: source.name })),
            ]}
            onValueChange={setSourceId}
          />
        </div>

        <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          <Checkbox
            checked={showArchived}
            onCheckedChange={setShowArchived}
            ariaLabel="Show archived companies"
          />
          Archived
        </label>
      </div>

      {rows.length === 0 && !isLoading ? (
        filtered ? (
          <EmptyState
            title={`Nothing matches "${search.trim() || "those filters"}"`}
            description="Clear the filters to see every company, or add this one now."
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
                  Add a company
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            title={showArchived ? "Nothing archived" : "No companies yet"}
            description={
              showArchived
                ? "Companies you delete stay here until you restore them."
                : `A company groups the people you work with at one business, and every ${vocabulary.lower} you have quoted them.`
            }
            action={
              showArchived ? (
                <Button variant="secondary" onClick={() => setShowArchived(false)}>
                  Back to companies
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  Add your first company
                </Button>
              )
            }
          />
        )
      ) : (
        // NOTE (phase two, direction rule 1): this panel fills the content column,
        // so a list shorter than the window paints a slab of empty surface below
        // its last row. Making the panel content-height here does not work - the
        // VirtualList measures its own flex height, and a content-height parent
        // measures 0 before the first rows arrive, so the list renders nothing
        // (caught by listNav.e2e.ts). It needs the kit's bounded-region
        // primitive; raised with lead-platform as a kit finding.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* The column strip: the one uppercase type in the product, which is
              how a native list view labels a column (DESIGN.md §4). Name is
              the only header that can sort - the only column the "Sort"
              Select below can also express - and clicking it drives that
              same `sort` state, so the two never disagree.

              Open jobs answers "is there work on here" (F-LA-7, CPO audit) -
              the count and the value the owner cannot get from the name and
              the phone number alone. Tags drops first as the window narrows,
              same as Contacts. */}
          <div
            role="row"
            className="section-label flex h-[var(--control-h)] w-full flex-none items-center gap-[var(--space-4)] border-b border-[var(--color-border)] px-[var(--space-4)]"
          >
            <ColumnHeaderCell
              className="min-w-0 flex-1"
              sortable
              sortDirection={nameSortDirection(sort)}
              onSort={() => setSort(sort === "name-asc" ? "name-desc" : "name-asc")}
            >
              Name
            </ColumnHeaderCell>
            <ColumnHeaderCell className="w-[200px] flex-none">Phone</ColumnHeaderCell>
            <ColumnHeaderCell align="right" className="w-[140px] flex-none">
              Open {vocabulary.lowerMany}
            </ColumnHeaderCell>
            <ColumnHeaderCell align="right" className="hidden w-[180px] flex-none lg:block">
              Tags
            </ColumnHeaderCell>
          </div>
          <VirtualList
            items={rows}
            ariaLabel="Companies"
            className="min-h-0 flex-1 max-h-[calc(100vh-280px)]"
            getKey={(company) => company.id}
            keyboardNav={{
              onActivate: (company) => navigate(`/companies/${company.id}`),
            }}
            renderRow={(company, _index, nav) => (
              <CompanyRow
                company={company}
                tagNames={(tagIndex?.get(company.id) ?? []).map((tag) => tag.name)}
                onOpen={() => navigate(`/companies/${company.id}`)}
                nav={nav}
              />
            )}
          />
        </div>
      )}

      <NewCompanyDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => navigate(`/companies/${id}`)}
      />
    </div>
  );
}

/** The "Name" column header's direction, or null when the list is sorted by
 *  something the header cannot express (newest) - it only ever offers the
 *  two orders the SORTS options already cover. */
function nameSortDirection(sort: string): SortDirection {
  if (sort === "name-asc") return "asc";
  if (sort === "name-desc") return "desc";
  return null;
}

/** An em dash for a cell with nothing to show — a company with no open work
 *  reads a dash here, never "0", which would read as a fact about the deal
 *  count rather than the absence of one. */
const EMPTY_CELL = "—";

function CompanyRow(props: {
  company: CompanyListRow;
  tagNames: string[];
  onOpen: () => void;
  /** Roving-tabindex + arrow-key props from VirtualList's `keyboardNav`
   *  (apple-hig-review.md finding 6). Falls back to the row's own Enter/Space
   *  handling so CompanyRow still works stand-alone. */
  nav?: RowNavProps;
}) {
  const { company, tagNames, onOpen, nav } = props;
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

  return (
    <div
      role="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-[var(--row-h)] w-full cursor-default items-center gap-[var(--space-4)]",
        "border-b border-[var(--color-border)] px-[var(--space-4)]",
        "hover:bg-[var(--color-hover)]",
        focusRingInset,
      )}
      {...rowNav}
    >
      <div
        className="min-w-0 flex-1 truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
        title={company.name}
      >
        {company.name}
      </div>
      <div className="w-[200px] shrink-0 truncate tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {company.phoneRaw ? formatPhone(company.phoneRaw) || company.phoneRaw : "No phone"}
      </div>
      <div className="w-[140px] shrink-0 truncate text-right tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {company.openDealCount > 0 ? (
          <>
            {company.openDealCount.toLocaleString()}
            {" · "}
            {formatMoneyTrim(company.openDealValueCents)}
          </>
        ) : (
          <span className="text-[var(--color-text-faint)]">{EMPTY_CELL}</span>
        )}
      </div>
      <div className="hidden w-[180px] shrink-0 items-center justify-end gap-[var(--space-1)] lg:flex">
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

export function NewCompanyDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (name.trim().length === 0) {
      setError("Give the company a name.");
      return;
    }
    setError(null);
    setSaving(true);
    const batchId = newBatchId();
    try {
      const company = await companiesRepo.create({ name, phone, website }, { batchId });
      await invalidateRecords();
      offerUndoCreate(batchId, company.name);
      setName("");
      setPhone("");
      setWebsite("");
      props.onOpenChange(false);
      props.onCreated?.(company.id);
    } catch (err) {
      reportError(err, "That company did not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            A name is all that is required. You can add people and jobs to it afterwards.
          </DialogDescription>
        </DialogHeader>
        <FormRow>
          <Field label="Company name" required error={error ?? undefined}>
            <Input
              autoFocus
              value={name}
              placeholder="Sorensen Landscaping"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void create();
                }
              }}
            />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={phone}
              placeholder="(801) 555-0147"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label="Website">
            <Input
              value={website}
              placeholder="sorensenlandscaping.com"
              onChange={(event) => setWebsite(event.target.value)}
            />
          </Field>
        </FormRow>
        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void create()}>
            Create company
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
