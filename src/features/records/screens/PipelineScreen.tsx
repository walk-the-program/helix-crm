/**
 * The pipeline: a board by default, a list when a table reads better.
 *
 * The word on screen comes from the workspace vocabulary — Deals, Jobs or
 * Quotes — while the database, the routes and this file's variables all keep
 * saying "deal".
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { KanbanSquare, LayoutList, Plus, Settings2, Table2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
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
  usePipeline,
  useStages,
  useTasks,
} from "@/features/records/lib/hooks";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { PipelineBoard } from "@/features/records/components/PipelineBoard";
import { NewDealDialog } from "@/features/records/components/NewDealDialog";
import { StageManagerDialog } from "@/features/records/components/StageManagerDialog";

export function PipelineScreen() {
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [managingStages, setManagingStages] = useState(false);

  const { data: pipeline, isLoading: pipelineLoading } = usePipeline();
  const { data: stages } = useStages(pipeline?.id);
  const { data: board, isLoading: boardLoading } = useBoard(pipeline?.id);
  const { data: listDeals } = useDeals({ pipelineId: pipeline?.id }, 5000);
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
        icon={<KanbanSquare size={24} aria-hidden="true" />}
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
          <>
            <Button
              variant="ghost"
              iconLeft={
                view === "board" ? (
                  <Table2 size={20} aria-hidden="true" />
                ) : (
                  <LayoutList size={20} aria-hidden="true" />
                )
              }
              className="min-h-[44px]"
              onClick={() => setView((current) => (current === "board" ? "list" : "board"))}
            >
              {view === "board" ? "List view" : "Board view"}
            </Button>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              iconLeft={<Settings2 size={20} aria-hidden="true" />}
              onClick={() => setManagingStages(true)}
            >
              Stages
            </Button>
            <Button
              variant="primary"
              className="min-h-[44px]"
              iconLeft={<Plus size={20} aria-hidden="true" />}
              onClick={() => setCreating(true)}
            >
              {vocabulary.newOne}
            </Button>
          </>
        }
      />

      {empty ? (
        <EmptyState
          icon={<KanbanSquare size={24} aria-hidden="true" />}
          title={`No ${vocabulary.lowerMany} yet`}
          description={`Every quote you give somebody is one of these. Add the one you promised this week and it lands in ${stages[0].name}.`}
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {vocabulary.newOne}
            </Button>
          }
        />
      ) : view === "board" ? (
        <div className="mt-[var(--space-4)] flex min-h-0 flex-1 flex-col">
          <p className="mb-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            Drag a card, or focus one and hold shift with an arrow key to move it.
          </p>
          <PipelineBoard
            stages={stages}
            board={board ?? []}
            nextStepByDealId={nextStepByDealId}
          />
        </div>
      ) : (
        <div className="mt-[var(--space-4)] overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <Table>
            <THead>
              <TR>
                <TH>{vocabulary.one}</TH>
                <TH>Company</TH>
                <TH>Stage</TH>
                <TH align="right">Value</TH>
                <TH>Expected</TH>
              </TR>
            </THead>
            <TBody>
              {(listDeals?.rows ?? []).map((deal) => (
                <TR key={deal.id} onClick={() => navigate(`/deals/${deal.id}`)}>
                  <TD>
                    <span className="block max-w-[320px] truncate text-[length:var(--text-lg)] font-medium" title={deal.title}>
                      {deal.title}
                    </span>
                  </TD>
                  <TD>
                    <span className="block max-w-[220px] truncate text-[var(--color-text-muted)]" title={deal.companyName ?? ""}>
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
                  <TD>
                    <span className="tabular text-[var(--color-text-muted)]">
                      {deal.expectedOn ? formatDateDisplay(deal.expectedOn) : "—"}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
