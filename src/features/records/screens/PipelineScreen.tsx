/**
 * The pipeline: a board by default, a list when a table reads better.
 *
 * The word on screen comes from the workspace vocabulary — Deals, Jobs or
 * Quotes — while the database, the routes and this file's variables all keep
 * saying "deal".
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ListDashes, Plus, SlidersHorizontal, Table as TableIcon } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/ui";
import { useVocabulary } from "@/app/vocabulary";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import {
  useBoard,
  useDeals,
  useDebounced,
  usePipeline,
  useSources,
  useStages,
  useTasks,
} from "@/features/records/lib/hooks";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { PipelineBoard } from "@/features/records/components/PipelineBoard";
import { NewDealDialog } from "@/features/records/components/NewDealDialog";
import { StageManagerDialog } from "@/features/records/components/StageManagerDialog";
import {
  queryFromState,
  stateFromQuery,
  useSavedViews,
  ViewsToolbar,
  type ViewQuery,
} from "@/features/today/views";

const ALL = "__all__";

/**
 * The list side's filter state. The board has no filters of its own (it always
 * shows every open deal), so only the list's search and source narrow what
 * `useDeals` fetches for the table. There is no sort control — the list keeps
 * the repository's own stage/position order — so saved views for this screen
 * carry no `sort` entry.
 */
const FILTER_DEFAULTS = {
  search: "",
  sourceId: ALL,
};

export function PipelineScreen() {
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [managingStages, setManagingStages] = useState(false);
  const [search, setSearch] = useState(FILTER_DEFAULTS.search);
  const [sourceId, setSourceId] = useState(FILTER_DEFAULTS.sourceId);

  const currentView: ViewQuery = useMemo(
    () => queryFromState({ search, sourceId }, FILTER_DEFAULTS, null),
    [search, sourceId],
  );

  function applyView(query: ViewQuery | null) {
    const next = stateFromQuery(query, FILTER_DEFAULTS);
    setSearch(next.search);
    setSourceId(next.sourceId);
  }

  // A link from the sidebar's Views group lands here with `?view=<id>` before
  // the row itself has been read, so apply it when it arrives — once per view.
  const { activeId, activeQuery } = useSavedViews("deal", currentView);
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId || !activeQuery || appliedViewId === activeId) return;
    setAppliedViewId(activeId);
    applyView(activeQuery);
  }, [activeId, activeQuery, appliedViewId]);

  const debouncedSearch = useDebounced(search, 200);
  const { data: sources } = useSources();

  const { data: pipeline, isLoading: pipelineLoading } = usePipeline();
  const { data: stages } = useStages(pipeline?.id);
  const { data: board, isLoading: boardLoading } = useBoard(pipeline?.id);
  const { data: listDeals } = useDeals(
    {
      pipelineId: pipeline?.id,
      search: debouncedSearch.trim() || undefined,
      sourceId: sourceId === ALL ? undefined : sourceId,
    },
    5000,
  );
  const { data: openTasks } = useTasks({ openOnly: true }, 2000);

  /** The "next step" line on every card: the soonest open task on that deal. */
  const nextStepByDealId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of openTasks?.rows ?? []) {
      if (!task.dealId || map.has(task.dealId)) continue;
      map.set(task.dealId, `${task.title} · ${dueLabel(task)}`);
    }
    return map;
  }, [openTasks]);

  const totals = useMemo(() => {
    const deals = (board ?? []).flatMap((column) => column.deals);
    return {
      count: deals.length,
      cents: deals.reduce((sum, deal) => sum + deal.valueCents, 0),
      currency: deals[0]?.currency ?? "USD",
    };
  }, [board]);

  if (pipelineLoading || boardLoading) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-6)]">
        <Spinner /> <span className="text-[var(--color-text-muted)]">Loading</span>
      </div>
    );
  }

  if (!pipeline || !stages || stages.length === 0) {
    return (
      <EmptyState
        title="No stages yet"
        description="A pipeline needs at least one stage before it can hold anything."
        action={
          <Button variant="primary" onClick={() => setManagingStages(true)}>
            Set up stages
          </Button>
        }
      />
    );
  }

  const empty = totals.count === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={vocabulary.many}
        subtitle={
          <span className="tabular">
            {totals.count} open · {formatMoney(totals.cents, totals.currency)}
          </span>
        }
        actions={
          <div className="flex items-center gap-[var(--space-2)]">
            <ViewsToolbar
              entityType="deal"
              current={currentView}
              onPick={(query) => applyView(query)}
            />
            <Button
              variant="ghost"
              iconLeft={
                view === "board" ? (
                  <TableIcon size={16} weight="bold" aria-hidden="true" />
                ) : (
                  <ListDashes size={16} weight="bold" aria-hidden="true" />
                )
              }
              onClick={() => setView((current) => (current === "board" ? "list" : "board"))}
            >
              {view === "board" ? "List view" : "Board view"}
            </Button>
            <Button
              variant="secondary"
              iconLeft={<SlidersHorizontal size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setManagingStages(true)}
            >
              Stages
            </Button>
            <Button
              variant="primary"
              iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setCreating(true)}
            >
              {vocabulary.newOne}
            </Button>
          </div>
        }
      />

      {empty ? (
        <EmptyState
          title={`No ${vocabulary.lowerMany} yet`}
          description={`Every quote you give somebody is one of these. Add the one you promised this week and it lands in ${stages[0].name}.`}
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {vocabulary.newOne}
            </Button>
          }
        />
      ) : view === "board" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="pb-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            Drag a card, or focus one and hold shift with an arrow key to move it.
          </p>
          <PipelineBoard
            stages={stages}
            board={board ?? []}
            nextStepByDealId={nextStepByDealId}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* A toolbar, not a form: the macOS search field and one pop-up
              button, separated from the list by one hairline. */}
          <div className="flex flex-wrap items-center gap-[var(--space-2)] pb-[var(--space-4)]">
            <label htmlFor="deal-search" className="sr-only">
              Search
            </label>
            <Input
              search
              id="deal-search"
              aria-label="Search deals"
              value={search}
              placeholder="Title or company"
              className="w-[280px] flex-none"
              onChange={(event) => setSearch(event.target.value)}
            />
            <label htmlFor="deal-source" className="sr-only">
              Source
            </label>
            <Select
              id="deal-source"
              ariaLabel="Filter by source"
              className="w-[170px] flex-none"
              value={sourceId}
              options={[
                { value: ALL, label: "Any source" },
                ...(sources ?? []).map((source) => ({ value: source.id, label: source.name })),
              ]}
              onValueChange={setSourceId}
            />
          </div>

          <div className="mt-[var(--space-4)] overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <Table>
              <THead>
                <TR>
                  <TH className="w-[34%]">{vocabulary.one}</TH>
                  <TH className="w-[22%]">Company</TH>
                  <TH className="w-[18%]">Stage</TH>
                  <TH align="right" className="w-[13%]">
                    Value
                  </TH>
                  <TH className="w-[13%]">Expected</TH>
                </TR>
              </THead>
              <TBody>
                {(listDeals?.rows ?? []).map((deal) => (
                  <TR key={deal.id} onClick={() => navigate(`/deals/${deal.id}`)}>
                    <TD primary title={deal.title}>
                      {deal.title}
                    </TD>
                    <TD muted>
                      <span className="block max-w-[220px] truncate" title={deal.companyName ?? ""}>
                        {deal.companyName ?? "—"}
                      </span>
                    </TD>
                    <TD>
                      <Badge dotColor={stages.find((s) => s.id === deal.stageId)?.color}>
                        {deal.stageName}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <span className="money">{formatMoney(deal.valueCents, deal.currency)}</span>
                    </TD>
                    <TD muted>
                      <span className="tabular">
                        {deal.expectedOn ? formatDateDisplay(deal.expectedOn) : "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      )}

      <NewDealDialog
        open={creating}
        onOpenChange={setCreating}
        pipelineId={pipeline.id}
        defaultStageId={stages[0]?.id}
        onCreated={(id) => navigate(`/deals/${id}`)}
      />

      <StageManagerDialog
        open={managingStages}
        onOpenChange={setManagingStages}
        pipelineId={pipeline.id}
        stages={stages}
        vocabularyMany={vocabulary.many}
      />
    </div>
  );
}
