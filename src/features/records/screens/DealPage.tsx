/**
 * One deal — or job, or quote, depending on the workspace vocabulary.
 *
 * Won and lost are stage flags, so both are reached through the stage picker;
 * moving to a lost stage asks for a reason, which the repository requires.
 */
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Building2, RotateCcw, Trash2, User } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Spinner,
} from "@/ui";
import * as dealsRepo from "@/db/repos/deals";
import { contactName } from "@/db/repos/contacts";
import { useVocabulary } from "@/app/vocabulary";
import { centsToDecimalString, formatMoney, parseMoneyToCents } from "@/lib/money";
import { formatDateDisplay, formatRelative } from "@/lib/dates";
import { useContact, useDeal, useStages, usePipeline } from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  reportError,
} from "@/features/records/lib/mutations";
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

export function DealPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const { data: deal, isLoading } = useDeal(id);
  const { data: pipeline } = usePipeline();
  const { data: stages } = useStages(pipeline?.id);
  const { data: contact } = useContact(deal?.contactId ?? "");
  const [pendingLostStage, setPendingLostStage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const openStages = useMemo(
    () => (stages ?? []).filter((stage) => !stage.isWon && !stage.isLost),
    [stages],
  );

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

  async function patch(values: dealsRepo.DealPatch) {
    await dealsRepo.update(id, values);
    await invalidateRecords();
  }

  async function changeStage(stageId: string) {
    const target = (stages ?? []).find((stage) => stage.id === stageId);
    if (target?.isLost && (deal?.outcomeReason ?? "").trim().length === 0) {
      setPendingLostStage(stageId);
      return;
    }
    try {
      await dealsRepo.moveToStage(id, stageId);
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That stage change did not save.");
    }
  }

  const closed = deal.stageIsWon || deal.stageIsLost;

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <Link
        href="/pipeline"
        className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {vocabulary.many}
      </Link>

      <section
        aria-label={`${vocabulary.one} summary`}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[length:var(--text-xl)] font-semibold text-[var(--color-text)]"
              title={deal.title}
            >
              {deal.title}
            </h1>
            <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-3)]">
              <Badge dotColor={(stages ?? []).find((s) => s.id === deal.stageId)?.color}>
                {deal.stageName}
              </Badge>
              {deal.stageIsWon ? <Badge tone="success">Won</Badge> : null}
              {deal.stageIsLost ? <Badge tone="danger">Lost</Badge> : null}
              <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                In this stage {formatRelative(deal.stageEnteredAt)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-[var(--space-3)]">
            <span className="money text-[length:var(--text-2xl)] font-semibold text-[var(--color-text)]">
              {formatMoney(deal.valueCents, deal.currency)}
            </span>
            {closed && openStages.length > 0 ? (
              <Button
                variant="secondary"
                className="min-h-[44px]"
                iconLeft={<RotateCcw size={20} aria-hidden="true" />}
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
              variant="secondary"
              className="min-h-[44px]"
              iconLeft={<Trash2 size={20} aria-hidden="true" />}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-4)]">
          {deal.contactId ? (
            <Link
              href={`/contacts/${deal.contactId}`}
              className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-base)] text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            >
              <User size={16} aria-hidden="true" />
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
              <Building2 size={16} aria-hidden="true" />
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
          <p className="mt-[var(--space-3)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">Reason: </span>
            {deal.outcomeReason}
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <Timeline fill dealId={id} />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <TaskRail dealId={id} />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-[var(--space-5)]">
              <InlineText
                label="Title"
                value={deal.title}
                onSave={(value) => patch({ title: value })}
              />

              <InlineText
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

              <div>
                <label
                  htmlFor="deal-stage"
                  className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
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

              <InlineText
                label="Expected date"
                type="date"
                value={deal.expectedOn ?? ""}
                onSave={(value) => patch({ expectedOn: value.trim().length > 0 ? value : null })}
              />

              <div>
                <label
                  htmlFor="deal-contact"
                  className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                >
                  Contact
                </label>
                <ContactPicker
                  id="deal-contact"
                  label="Contact"
                  value={deal.contactId}
                  onChange={(contactId) => {
                    void patch({ contactId }).catch((err: unknown) =>
                      reportError(err, "That did not save."),
                    );
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="deal-company"
                  className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                >
                  Company
                </label>
                <CompanyPicker
                  id="deal-company"
                  label="Company"
                  value={deal.companyId}
                  onChange={(companyId) => {
                    void patch({ companyId }).catch((err: unknown) =>
                      reportError(err, "That did not save."),
                    );
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="deal-source"
                  className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                >
                  Source
                </label>
                <SourcePicker
                  id="deal-source"
                  label="Source"
                  value={deal.sourceId}
                  onChange={(sourceId) => {
                    void patch({ sourceId }).catch((err: unknown) =>
                      reportError(err, "That did not save."),
                    );
                  }}
                />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Tags
                </h3>
                <TagEditor entityType="deal" entityId={id} />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Custom fields
                </h3>
                <CustomFieldsPanel entityType="deal" entityId={id} />
              </div>
            </CardBody>
          </Card>
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
