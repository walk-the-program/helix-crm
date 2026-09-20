/**
 * One deal — or job, or quote, depending on the workspace vocabulary.
 *
 * Won and lost are stage flags, so both are reached through the stage picker;
 * moving to a lost stage asks for a reason, which the repository requires.
 */
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowCounterClockwise, ArrowLeft, Buildings, Trash, User } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/ui";
import * as dealsRepo from "@/db/repos/deals";
import { contactName } from "@/db/repos/contacts";
import { useVocabulary } from "@/app/vocabulary";
import {
  centsToDecimalString,
  formatBreakdown,
  formatMoneyTrim,
  parseMoneyToCents,
} from "@/lib/money";
import { formatDateDisplay, formatRelative } from "@/lib/dates";
import { useContact, useDeal, useStages, usePipeline, useTasks } from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  reportError,
  writeWithUndo,
} from "@/features/records/lib/mutations";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { InlineText } from "@/features/records/components/InlineEdit";
import {
  CompanyPicker,
  ContactPicker,
  SourcePicker,
  StagePicker,
} from "@/features/records/components/Pickers";
import { TagEditor } from "@/features/records/components/TagEditor";
import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";
import { Timeline } from "@/features/records/components/Timeline";
import { TaskRail } from "@/features/records/components/TaskRail";
import { LostReasonDialog } from "@/features/records/components/LostReasonDialog";
import { AttachmentList } from "@/features/data/attachments/AttachmentList";
import { DealServicesPanel } from "@/features/catalog/components/DealServicesPanel";
import { useDealItems } from "@/features/catalog/lib/dealItemHooks";
import * as dealItemsRepo from "@/db/repos/dealItems";
import { DraftFollowUpButton, SummarizeButton } from "@/features/ai";
import { DealInvoicesPanel } from "@/features/invoices";

export function DealPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const { data: deal, isLoading } = useDeal(id);
  const { data: pipeline } = usePipeline();
  const { data: stages } = useStages(pipeline?.id);
  const { data: contact } = useContact(deal?.contactId ?? "");
  const { data: openTasks } = useTasks({ dealId: id, openOnly: true }, 20);
  // Shared with the Services panel below through the query cache, so this is
  // the same read rather than a second one.
  const { data: dealItems } = useDealItems(id);
  const [pendingLostStage, setPendingLostStage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const openStages = useMemo(
    () => (stages ?? []).filter((stage) => !stage.isWon && !stage.isLost),
    [stages],
  );
  const nextTask = useMemo(() => (openTasks?.rows ?? [])[0] ?? null, [openTasks]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-6)]">
        <Spinner /> <span className="text-[var(--color-text-muted)]">Loading</span>
      </div>
    );
  }

  if (!deal) {
    return (
      <EmptyState
        title={`That ${vocabulary.lower} is gone`}
        description="It may have been deleted."
        action={
          <Button variant="primary" onClick={() => navigate("/pipeline")}>
            Back to {vocabulary.lowerMany}
          </Button>
        }
      />
    );
  }

  const dealTitle = deal.title;

  // Inline edits autosave with no toast, so the undo stack is the only thing
  // standing between the owner and a field they overwrote by accident. Each
  // save is its own batch (design/apple-hig-review.md, finding 3).
  async function patch(values: dealsRepo.DealPatch) {
    await writeWithUndo({
      label: `edited ${dealTitle}`,
      write: (batchId) => dealsRepo.update(id, values, { batchId }).then(() => undefined),
    });
    await invalidateRecords();
  }

  async function changeStage(stageId: string) {
    const target = (stages ?? []).find((stage) => stage.id === stageId);
    if (target?.isLost && (deal?.outcomeReason ?? "").trim().length === 0) {
      setPendingLostStage(stageId);
      return;
    }
    try {
      // Same batch-and-push as a drag on the board: the stage picker and the
      // card are two ways to do one thing, so Cmd+Z has to reverse both.
      await writeWithUndo({
        label: `moved ${dealTitle} to ${target?.name ?? "another stage"}`,
        write: (batchId) => dealsRepo.moveToStage(id, stageId, { batchId }).then(() => undefined),
      });
      // Winning a deal that has recurring lines starts its clock, and the
      // recompute is what decides that (D20). It is a second transaction
      // rather than part of the move, because the move belongs to the deals
      // repository and the money belongs to this one.
      await dealItemsRepo.recompute(id);
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That stage change did not save.");
    }
  }

  const closed = deal.stageIsWon || deal.stageIsLost;
  const pricedFromServices = (dealItems ?? []).length > 0;
  const primaryEmail = contact
    ? (contact.emails.find((email) => email.isPrimary) ?? contact.emails[0] ?? null)
    : null;

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        breadcrumb={
          <Link
            href="/pipeline"
            className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            <ArrowLeft size={14} weight="bold" aria-hidden="true" /> {vocabulary.many}
          </Link>
        }
        title={deal.title}
        actions={
          <>
            {closed && openStages.length > 0 ? (
              <Button
                variant="secondary"
                iconLeft={<ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />}
                onClick={() => {
                  void dealsRepo
                    .reopen(id, openStages[0].id)
                    .then(invalidateRecords)
                    .catch((err: unknown) => reportError(err, "That did not reopen."));
                }}
              >
                Reopen
              </Button>
            ) : null}
            <Button
              variant="destructive"
              iconLeft={<Trash size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          {/* The one primary block on this screen: the money, flat-filled,
              with the offset sticker outline as its single detail. Everything
              else on the deal page is a neutral or a hairline. */}
          <span
            data-testid="deal-value"
            className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)] shadow-[var(--shadow-sticker)]"
          >
            {formatMoneyTrim(deal.valueCents, deal.currency)}
          </span>
          {deal.recurringMonthlyCents > 0 ? (
            <span
              data-testid="deal-breakdown"
              className="money text-[length:var(--text-base)] text-[var(--color-text-muted)]"
            >
              {formatBreakdown(deal.oneTimeCents, deal.recurringMonthlyCents, {
                currency: deal.currency,
                upfrontLabel: true,
              })}
            </span>
          ) : null}
          <Badge dotColor={(stages ?? []).find((s) => s.id === deal.stageId)?.color}>
            {deal.stageName}
          </Badge>
          {deal.stageIsWon ? <Badge tone="success">Won</Badge> : null}
          {deal.stageIsLost ? <Badge tone="danger">Lost</Badge> : null}
          <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            In this stage {formatRelative(deal.stageEnteredAt)}
          </span>
        </div>

        {/* The two AI actions, together and out of the header. Each renders its
            own disabled reason; the cluster shows the first one only, because
            the same sentence twice in a row is noise. */}
        <div className="flex flex-wrap items-center gap-[var(--space-2)] [&>*:not(:first-child)_[data-testid=ai-disabled-reason]]:hidden">
          <DraftFollowUpButton dealId={id} email={primaryEmail?.emailLower ?? null} />
          <SummarizeButton entityType="deal" entityId={id} />
        </div>

        <p className="text-[length:var(--text-base)]">
          <span className="text-[var(--color-text-muted)]">Next step: </span>
          {nextTask ? (
            <span className="text-[var(--color-text)]">
              {nextTask.title}{" "}
              <span className="tabular text-[var(--color-text-muted)]">
                · {dueLabel(nextTask)}
              </span>
            </span>
          ) : (
            <span className="text-[var(--color-text-faint)]">none yet</span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-[var(--space-4)]">
          {deal.contactId ? (
            <Link
              href={`/contacts/${deal.contactId}`}
              className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-base)] text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              <User size={16} weight="regular" aria-hidden="true" />
              <span className="max-w-[240px] truncate">
                {contact ? contactName(contact) : "Contact"}
              </span>
            </Link>
          ) : null}
          {deal.companyId && deal.companyName ? (
            <Link
              href={`/companies/${deal.companyId}`}
              className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-base)] text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              <Buildings size={16} weight="regular" aria-hidden="true" />
              <span className="max-w-[240px] truncate" title={deal.companyName}>
                {deal.companyName}
              </span>
            </Link>
          ) : null}
          {deal.expectedOn ? (
            <span className="tabular text-[length:var(--text-base)] text-[var(--color-text-muted)]">
              Expected {formatDateDisplay(deal.expectedOn)}
            </span>
          ) : null}
        </div>

        {deal.outcomeReason ? (
          <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">Reason: </span>
            {deal.outcomeReason}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* self-start: the grid row is as tall as the details column, and a
            timeline stretched to 1900px with one empty state in the middle
            of it is a void, not a layout. */}
        <div className="flex min-w-0 flex-col gap-[var(--space-5)] xl:self-start">
          <DealServicesPanel
            dealId={id}
            currency={deal.currency}
            isWon={deal.stageIsWon}
            recurringStartedOn={deal.recurringStartedOn}
            recurringEndedOn={deal.recurringEndedOn}
          />
          <Timeline dealId={id} />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <TaskRail dealId={id} />

          <div>
            <CardGroupLabel>Identity</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <InlineText
                  className="w-full"
                  label="Title"
                  value={deal.title}
                  onSave={(value) => patch({ title: value })}
                />
              </CardRow>
              <CardRow className="items-stretch">
                {/* Once the deal has services on it, its value is theirs to
                    decide: `dealItems.recompute` rewrites value_cents in the
                    same transaction as any line change, so a number typed in
                    here would be thrown away by the next edit without saying
                    so. The row states where the figure comes from instead of
                    offering an edit that does not hold (D20). */}
                {pricedFromServices ? (
                  <div className="flex w-full items-baseline justify-between gap-[var(--space-3)]">
                    <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                      Value
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="money text-[length:var(--text-base)] text-[var(--color-text)]">
                        {formatMoneyTrim(deal.valueCents, deal.currency)}
                      </span>
                      <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
                        From the services above
                      </span>
                    </span>
                  </div>
                ) : (
                  <InlineText
                    className="w-full"
                    label="Value"
                    value={centsToDecimalString(deal.valueCents)}
                    inputClassName="money"
                    onSave={(value) => {
                      const cents = parseMoneyToCents(value);
                      if (cents === null) {
                        return Promise.reject(new Error("Enter an amount, for example 1500."));
                      }
                      return patch({ valueCents: cents });
                    }}
                  />
                )}
              </CardRow>
              <CardRow className="items-stretch">
                <InlineText
                  className="w-full"
                  label="Expected date"
                  type="date"
                  value={deal.expectedOn ?? ""}
                  onSave={(value) => patch({ expectedOn: value.trim().length > 0 ? value : null })}
                />
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Classification</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <label
                    htmlFor="deal-stage"
                    className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Stage
                  </label>
                  <StagePicker
                    id="deal-stage"
                    label="Stage"
                    pipelineId={pipeline?.id}
                    value={deal.stageId}
                    onChange={(stageId) => void changeStage(stageId)}
                  />
                </div>
              </CardRow>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <label
                    htmlFor="deal-contact"
                    className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Contact
                  </label>
                  <ContactPicker
                    id="deal-contact"
                    label="Contact"
                    value={deal.contactId}
                    onChange={(contactId) => {
                      void patch({ contactId }).catch((err: unknown) =>
                        reportError(err, "That change did not save."),
                      );
                    }}
                  />
                </div>
              </CardRow>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <label
                    htmlFor="deal-company"
                    className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Company
                  </label>
                  <CompanyPicker
                    id="deal-company"
                    label="Company"
                    value={deal.companyId}
                    onChange={(companyId) => {
                      void patch({ companyId }).catch((err: unknown) =>
                        reportError(err, "That change did not save."),
                      );
                    }}
                  />
                </div>
              </CardRow>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <label
                    htmlFor="deal-source"
                    className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Source
                  </label>
                  <SourcePicker
                    id="deal-source"
                    label="Source"
                    value={deal.sourceId}
                    onChange={(sourceId) => {
                      void patch({ sourceId }).catch((err: unknown) =>
                        reportError(err, "That change did not save."),
                      );
                    }}
                  />
                </div>
              </CardRow>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <span className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    Tags
                  </span>
                  <div className="mt-[var(--space-1)]">
                    <TagEditor entityType="deal" entityId={id} />
                  </div>
                </div>
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Custom fields</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <CustomFieldsPanel entityType="deal" entityId={id} />
                </div>
              </CardRow>
            </Card>
          </div>

          <DealInvoicesPanel dealId={id} />

          <AttachmentList entityType="deal" entityId={id} />
        </div>
      </div>

      <LostReasonDialog
        open={pendingLostStage !== null}
        dealTitle={deal.title}
        onOpenChange={(open) => {
          if (!open) setPendingLostStage(null);
        }}
        onConfirm={async (reason) => {
          const stageId = pendingLostStage;
          setPendingLostStage(null);
          if (!stageId) return;
          try {
            await dealsRepo.moveToStage(id, stageId, { outcomeReason: reason });
            await dealItemsRepo.recompute(id);
            await invalidateRecords();
          } catch (err) {
            reportError(err, "That stage change did not save.");
          }
        }}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${deal.title}?`}
        description={`It moves to Trash and can be restored for 30 days.`}
        confirmLabel={`Delete ${vocabulary.lower}`}
        destructive
        onConfirm={async () => {
          try {
            await deleteWithUndo({
              label: deal.title,
              remove: (batchId) => dealsRepo.softDelete(id, { batchId }),
              restore: (batchId) => dealsRepo.restore(id, { batchId }),
            });
            navigate("/pipeline");
          } catch (err) {
            reportError(err, "That could not be deleted.");
          }
        }}
      />
    </div>
  );
}
