/**
 * The pipeline: a board by default, a list when a table reads better.
 *
 * The word on screen comes from the workspace vocabulary — Deals, Jobs or
 * Quotes — while the database, the routes and this file's variables all keep
 * saying "deal".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useLocation } from "wouter";
import {
  CaretDown,
  DownloadSimple,
  Funnel,
  ListChecks,
  ListDashes,
  Plus,
  SlidersHorizontal,
  Table as TableIcon,
  Trash,
} from "@/ui/icons";
import {
  Badge,
  BulkBar,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  ConfirmDialog,
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
  toast,
  TR,
} from "@/ui";
import { useVocabulary } from "@/app/vocabulary";
import { useFormats } from "@/app/formats";
import { pushUndo } from "@/app/undo";
import { undoBatch } from "@/db/changeLog";
import * as bulkRepo from "@/db/repos/bulk";
import * as dealsRepo from "@/db/repos/deals";
import { formatBreakdown, formatMoneyTrim, formatMonthly } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import { useSelection } from "@/lib/selection";
import { upfrontCents } from "@/db/repos/dealItems";
import { pickSavePath, writeTextFileAt } from "@/features/data/lib/fsBridge";
import { toCsvFromObjects, type CsvCell } from "@/features/data/lib/exportCsv";
import {
  useBoard,
  useDeals,
  useDebounced,
  usePipeline,
  useSources,
  useStages,
  useTasks,
} from "@/features/records/lib/hooks";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { PipelineBoard } from "@/features/records/components/PipelineBoard";
import { dealCustomer } from "@/features/records/components/DealCard";
import { StageMoveDialog } from "@/features/records/components/StageMoveDialog";
import { TrashMark } from "@/features/records/components/RecordChip";
import { NewDealDialog } from "@/features/records/components/NewDealDialog";
import { StageManagerDialog } from "@/features/records/components/StageManagerDialog";
import {
  queryFromState,
  stateFromQuery,
  useSavedViews,
  ViewsToolbar,
  type ViewQuery,
} from "@/features/today/views";
import { SampleDataNote } from "@/features/onboarding";

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
  const formats = useFormats();
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
      map.set(task.dealId, `${task.title} · ${dueLabel(task, undefined, formats.locale)}`);
    }
    return map;
  }, [openTasks, formats.locale]);

  /**
   * The headline counts OPEN work only.
   *
   * `deals.board()` returns every live stage of the pipeline, won and lost
   * included, because those columns are drop targets. Totalling all of them and
   * calling the result "open" overstated the pipeline by everything ever won or
   * lost, and it grew forever: the landscaping sample read "10 open · Upfront
   * $108,280" for 7 open deals worth $103,930 (CPO audit, F-LA-2). Each deal
   * carries its own stage flags, so the filter needs no second read and covers
   * a deal sitting in a stage the board no longer has a row for.
   */
  const totals = useMemo(() => {
    const deals = (board ?? [])
      .flatMap((column) => column.deals)
      .filter((deal) => !deal.stageIsWon && !deal.stageIsLost);
    return {
      count: deals.length,
      // The two halves the columns show (D20). A deal with nothing recurring
      // contributes its whole value, so on a workspace that never sells a
      // contract this is simply the open value - which is why the word
      // "Upfront" only appears when there is a monthly half to distinguish it
      // from.
      upfront: deals.reduce((sum, deal) => sum + upfrontCents(deal), 0),
      monthly: deals.reduce((sum, deal) => sum + deal.recurringMonthlyCents, 0),
      currency: deals[0]?.currency ?? "USD",
    };
  }, [board]);

  // Bulk selection on the list view (LR-PX-C). Keyed by id, in the list's own
  // stage/position order, so `useSelection` can reconcile it whenever a
  // refilter or a refetch changes what `listDeals` holds — never on a scroll,
  // because this table is not virtualised and nothing about scrolling it
  // changes this array.
  const orderedDealIds = useMemo(() => (listDeals?.rows ?? []).map((deal) => deal.id), [listDeals]);
  const selection = useSelection(orderedDealIds);
  const [confirmingBulkTrash, setConfirmingBulkTrash] = useState(false);
  const [pendingStageMove, setPendingStageMove] = useState<{
    stageId: string;
    stageName: string;
    requiresReason: boolean;
  } | null>(null);

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

  /**
   * Move to stage. Picking an open stage from the menu moves right away, with
   * today's date, exactly the way an ordinary board drop does. Picking a won
   * or lost stage opens `StageMoveDialog` first — the same dialog the board
   * uses for one card — because a bulk move into a lost stage still needs one
   * reason, and `moveManyToStage` refuses (and rolls back) the WHOLE move
   * without one. Nothing is written until Confirm.
   */
  function handlePickStage(stageId: string, stageName: string, isWon: boolean, isLost: boolean) {
    if (isWon || isLost) {
      setPendingStageMove({ stageId, stageName, requiresReason: isLost });
      return;
    }
    void moveSelectedToStage(stageId, stageName, {});
  }

  async function moveSelectedToStage(
    stageId: string,
    stageName: string,
    options: { at?: string; outcomeReason?: string | null },
  ): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await dealsRepo.moveManyToStage(ids, stageId, options);
      const word = ids.length === 1 ? vocabulary.lower : vocabulary.lowerMany;
      await afterBulkAction(
        { batchId: result.batchId, count: result.moved },
        `moved ${ids.length} ${word} to ${stageName}`,
        `Moved ${ids.length} ${word} to ${stageName}`,
      );
    } catch (err) {
      reportError(err, "That move did not save.");
    }
  }

  async function handleSetSource(sourceId: string | null, sourceLabel: string | null): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.setDealsSource(ids, sourceId);
      const word = ids.length === 1 ? vocabulary.lower : vocabulary.lowerMany;
      const phrase = sourceLabel
        ? `set the source to ${sourceLabel} on ${ids.length} ${word}`
        : `cleared the source on ${ids.length} ${word}`;
      await afterBulkAction(result, phrase, `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`);
    } catch (err) {
      reportError(err, "That change did not save.");
    }
  }

  async function handleBulkTrash(): Promise<void> {
    const ids = selection.selectedIds;
    try {
      const result = await bulkRepo.trashDeals(ids);
      const word = ids.length === 1 ? vocabulary.lower : vocabulary.lowerMany;
      await afterBulkAction(
        result,
        `moved ${ids.length} ${word} to trash`,
        `Moved ${ids.length} ${word} to trash`,
      );
    } catch (err) {
      reportError(err, `Those ${vocabulary.lowerMany} could not be moved to trash.`);
    }
  }

  /** The same columns the list table shows, for exactly the ticked rows. */
  async function handleExportSelected(): Promise<void> {
    const ids = new Set(selection.selectedIds);
    const selectedRows = (listDeals?.rows ?? []).filter((deal) => ids.has(deal.id));
    type ExportRow = Record<string, CsvCell>;
    const headers = [
      { key: "title", label: vocabulary.one },
      { key: "customer", label: "Customer" },
      { key: "stage", label: "Stage" },
      { key: "value", label: "Value" },
      { key: "expected", label: "Expected" },
    ];
    const exportRows: ExportRow[] = selectedRows.map((deal) => ({
      title: deal.title,
      customer: dealCustomer(deal).name,
      stage: deal.stageName,
      value: (deal.valueCents / 100).toFixed(2),
      expected: deal.expectedOn ?? "",
    }));
    const csv = toCsvFromObjects<ExportRow>(headers, exportRows);
    try {
      const path = await pickSavePath({
        title: `Export selected ${vocabulary.lowerMany}`,
        defaultPath: `helix-${vocabulary.key}-selected-${todayLocal()}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path === null) return;
      await writeTextFileAt(path, csv);
      toast.success(`Exported ${selectedRows.length} ${vocabulary.lowerMany}`);
    } catch (err) {
      reportError(err, "That export did not save.");
    }
  }

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
          // "0 open - $0" over a "no jobs yet" empty state is a report about
          // nothing (phase two, direction rule 6).
          totals.count === 0 ? null : (
          <span className="tabular" data-testid="pipeline-total">
            {totals.count} open · {totals.monthly > 0 ? "Upfront " : null}
            {formatMoneyTrim(totals.upfront, totals.currency)}
            {totals.monthly > 0
              ? ` \u00b7 ${formatMonthly(totals.monthly, totals.currency)}`
              : null}
          </span>
          )
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
            // Not `vocabulary.newOne` again: the header button beside it already
            // says "New job", and the same words twice on one screen read as two
            // different things the owner has to tell apart. Contacts and
            // Companies already use the "Add your first ..." phrasing here.
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Add your first {vocabulary.lower}
            </Button>
          }
        />
      ) : view === "board" ? (
        // The keyboard hint used to be a permanent paragraph above the board. A
        // sentence that never goes away is not help, it is furniture: it costs a
        // line of the board every day to teach something once. The card's own
        // accessible name already carries it (DealCard), the board region
        // carries it as a tooltip, and Help says it in prose (F-LA-17c).
        <div
          className="flex min-h-0 flex-1 flex-col"
          title="Drag a card, or focus one and hold shift with an arrow key to move it."
        >
          <PipelineBoard
            stages={stages}
            board={board ?? []}
            nextStepByDealId={nextStepByDealId}
          />
          {/* A board card names the customer, the value and the next step and
              nothing else, so a made-up job and a real one look identical on
              it. The Sample tag every example row carries is on the record,
              not on the card. Rather than put a fifth thing on every card,
              the screen says it once, here, and only while the example set is
              actually in the workspace (LR-CS, F-CS-6). */}
          <SampleDataNote className="mt-[var(--space-4)] flex-none" />
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[var(--control-h-sm)]">
                      <Checkbox
                        checked={
                          orderedDealIds.length > 0 && selection.count === orderedDealIds.length
                            ? true
                            : selection.count > 0
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) =>
                          checked ? selection.selectAll() : selection.clear()
                        }
                        aria-label={`Select every ${vocabulary.lower} in this filter`}
                      />
                    </TH>
                    <TH className="w-[32%]">{vocabulary.one}</TH>
                    <TH className="w-[20%]">Customer</TH>
                    <TH className="w-[18%]">Stage</TH>
                    <TH align="right" className="w-[13%]">
                      Value
                    </TH>
                    <TH className="w-[13%]">Expected</TH>
                  </TR>
                </THead>
                <TBody>
                  {(listDeals?.rows ?? []).map((deal) => (
                    <TR
                      key={deal.id}
                      selected={selection.isSelected(deal.id)}
                      onClick={() => navigate(`/deals/${deal.id}`)}
                    >
                      <TD onClick={(event) => event.stopPropagation()}>
                        <DealRowCheckbox
                          label={deal.title}
                          checked={selection.isSelected(deal.id)}
                          onToggle={() => selection.toggle(deal.id)}
                          onRange={() =>
                            selection.onRowClick(deal.id, {
                              shiftKey: true,
                              metaKey: false,
                              ctrlKey: false,
                            })
                          }
                        />
                      </TD>
                      <TD primary title={deal.title}>
                        {deal.title}
                      </TD>
                      {/* The same customer the board card names. The list used to
                          print the COMPANY here, so a job for a person with no
                          company read as an em dash in the list and as "Priya
                          Raghunathan" on the board - two views of one thing
                          disagreeing about whose job it is (F-LA-12 fixed the
                          card; this is its other half). */}
                      <TD muted>
                        <span
                          className="block max-w-[220px] truncate"
                          title={dealCustomer(deal).tooltip}
                        >
                          {dealCustomer(deal).name}
                          <TrashMark deletedAt={dealCustomer(deal).deletedAt} />
                        </span>
                      </TD>
                      <TD>
                        <Badge dotColor={stages.find((s) => s.id === deal.stageId)?.color}>
                          {deal.stageName}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <span className="money" data-testid="row-value">
                          {deal.recurringMonthlyCents > 0
                            ? formatBreakdown(deal.oneTimeCents, deal.recurringMonthlyCents, {
                                currency: deal.currency,
                              })
                            : formats.money(deal.valueCents, deal.currency)}
                        </span>
                      </TD>
                      <TD muted>
                        <span className="tabular">
                          {deal.expectedOn ? formats.date(deal.expectedOn) : "—"}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <BulkBar
              count={selection.count}
              noun={{ one: vocabulary.lower, many: vocabulary.lowerMany }}
              onClear={selection.clear}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconRight={<CaretDown size={14} weight="bold" aria-hidden="true" />}
                  >
                    <ListChecks size={16} weight="bold" aria-hidden="true" /> Move to stage
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" data-testid="bulk-move-stage-menu">
                  {stages.length === 0 ? (
                    <DropdownMenuLabel>No stages yet</DropdownMenuLabel>
                  ) : (
                    stages.map((stage) => (
                      <DropdownMenuItem
                        key={stage.id}
                        onSelect={() => handlePickStage(stage.id, stage.name, stage.isWon, stage.isLost)}
                      >
                        {stage.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconRight={<CaretDown size={14} weight="bold" aria-hidden="true" />}
                  >
                    <Funnel size={16} weight="bold" aria-hidden="true" /> Set source
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => void handleSetSource(null, null)}>
                    No source
                  </DropdownMenuItem>
                  {(sources ?? []).map((source) => (
                    <DropdownMenuItem
                      key={source.id}
                      onSelect={() => void handleSetSource(source.id, source.name)}
                    >
                      {source.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

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

      {/* Bulk "move to stage" into a won or lost stage: the same dialog the
          board uses for one card. `moveManyToStage` refuses (and rolls back)
          the whole move without a reason when the target is a lost stage, so
          this collects one reason up front rather than letting the write
          fail after the fact. */}
      <StageMoveDialog
        open={pendingStageMove !== null}
        stageName={pendingStageMove?.stageName ?? ""}
        requiresReason={pendingStageMove?.requiresReason ?? false}
        onOpenChange={(open) => {
          if (!open) setPendingStageMove(null);
        }}
        onConfirm={async ({ at, outcomeReason }) => {
          const pending = pendingStageMove;
          setPendingStageMove(null);
          if (!pending) return;
          await moveSelectedToStage(pending.stageId, pending.stageName, { at, outcomeReason });
        }}
      />

      <ConfirmDialog
        open={confirmingBulkTrash}
        onOpenChange={setConfirmingBulkTrash}
        title={`Move ${selection.count} ${
          selection.count === 1 ? vocabulary.lower : vocabulary.lowerMany
        } to trash?`}
        description="They move to Trash and can be restored for 30 days."
        confirmLabel="Move to trash"
        destructive
        onConfirm={handleBulkTrash}
      />
    </div>
  );
}

/** The row checkbox: plain/Cmd/Ctrl click toggles, shift-click selects the
 *  range, and the click never reaches the row's own onClick (which opens the
 *  record) — the same pattern ContactsScreen's row checkbox uses. */
function DealRowCheckbox(props: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  onRange: () => void;
}) {
  const { label, checked, onToggle, onRange } = props;
  const shiftHeldRef = useRef(false);

  // Capture phase records the modifier BEFORE the checkbox's own click
  // (which fires onCheckedChange) sees it; the bubble phase then stops the
  // click from reaching the row's onClick. See ContactsScreen's ContactRow
  // for the longer version of this note — the two phases cannot be merged
  // into one handler without reading the modifier one click late.
  function handleClickCapture(event: MouseEvent<HTMLElement>) {
    shiftHeldRef.current = event.shiftKey;
  }

  function handleClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <div
      className="flex w-[var(--control-h-sm)] flex-none items-center justify-center"
      onClickCapture={handleClickCapture}
      onClick={handleClick}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={() => (shiftHeldRef.current ? onRange() : onToggle())}
        aria-label={`Select ${label}`}
      />
    </div>
  );
}
