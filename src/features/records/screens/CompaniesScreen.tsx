/**
 * The companies list. Same shape as contacts — search, sort, tag and source
 * filters, virtualised rows — because the owner should not have to learn two
 * lists.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  Checkbox,
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
} from "@/ui";
import * as companiesRepo from "@/db/repos/companies";
import type { Company } from "@/db/repos/companies";
import { formatPhone } from "@/lib/phone";
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={showArchived ? "Archived companies" : "Companies"}
        subtitle={
          isLoading
            ? "Loading"
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

      <div className="flex flex-wrap items-center gap-[var(--space-3)] py-[var(--space-4)]">
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
                : "A company groups the people you deal with at one business, and every job you have quoted them."
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* The column strip: the one uppercase type in the product, which is
              how a native list view labels a column (DESIGN.md §4). */}
          <div className="flex h-[var(--control-h)] w-full flex-none items-center gap-[var(--space-4)] border-b border-[var(--color-border)] px-[var(--space-4)] text-[length:var(--text-label)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-faint)]" aria-hidden="true">
            <span className="min-w-0 flex-1">Name</span>
            <span className="w-[200px] flex-none">Phone</span>
            <span className="hidden w-[180px] flex-none text-right md:block">Tags</span>
          </div>
          <VirtualList
            items={rows}
            ariaLabel="Companies"
            className="min-h-0 flex-1 max-h-[calc(100vh-280px)]"
            getKey={(company) => company.id}
            renderRow={(company) => (
              <CompanyRow
                company={company}
                tagNames={(tagIndex?.get(company.id) ?? []).map((tag) => tag.name)}
                onOpen={() => navigate(`/companies/${company.id}`)}
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

function CompanyRow(props: { company: Company; tagNames: string[]; onOpen: () => void }) {
  const { company, tagNames, onOpen } = props;
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
        title={company.name}
      >
        {company.name}
      </div>
      <div className="w-[200px] shrink-0 truncate tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {company.phoneRaw ? formatPhone(company.phoneRaw) || company.phoneRaw : "No phone"}
      </div>
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
