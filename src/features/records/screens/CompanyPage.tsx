/**
 * One company: its people, its open and closed jobs, and one merged timeline
 * that includes everything logged against its contacts — because the owner
 * remembers "that call with the HOA", not which of three board members he
 * happened to speak to.
 */
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Globe, Phone, Trash, UserPlus } from "@/ui/icons";
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
import * as companiesRepo from "@/db/repos/companies";
import { contactName } from "@/db/repos/contacts";
import { formatPhone } from "@/lib/phone";
import { todayLocal } from "@/lib/dates";
import { useVocabulary } from "@/app/vocabulary";
import {
  useCompany,
  useCompanyCounts,
  useCustomerMoney,
  useContacts,
  useDeals,
  useMergedInto,
} from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  writeWithUndo,
  reportError,
} from "@/features/records/lib/mutations";
import { oneTap } from "@/lib/actions";
import { InlineText, InlineTextarea } from "@/features/records/components/InlineEdit";
import { SourcePicker } from "@/features/records/components/Pickers";
import { CustomerMoneyStrip } from "@/features/records/components/MoneyStrip";
import { DealsCard } from "@/features/records/components/DealsCard";
import { AddressPanel } from "@/features/records/components/AddressPanel";
import { TagEditor } from "@/features/records/components/TagEditor";
import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";
import { Timeline } from "@/features/records/components/Timeline";
import { TaskRail } from "@/features/records/components/TaskRail";
import { AttachmentList } from "@/features/data/attachments/AttachmentList";
import { RecurringPanel } from "@/features/recurring";
import { SummarizeButton } from "@/features/ai";

export function CompanyPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const { data: company, isLoading } = useCompany(id);
  const { data: money } = useCustomerMoney({ companyId: id });
  const { data: counts } = useCompanyCounts(id);
  const { data: contacts } = useContacts({ companyId: id }, 500);
  const { data: openDeals } = useDeals({ companyId: id, openOnly: true }, 200);
  const { data: closedDeals } = useDeals({ companyId: id, closedOnly: true }, 200);
  const { data: mergedInto } = useMergedInto("company", id, company?.deletedAt != null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-6)]">
        <Spinner /> <span className="text-[var(--color-text-muted)]">Loading</span>
      </div>
    );
  }

  if (!company) {
    return (
      <EmptyState
        title="That company is gone"
        description="It may have been deleted or merged into another record."
        action={
          <Button variant="primary" onClick={() => navigate("/companies")}>
            Back to companies
          </Button>
        }
      />
    );
  }

  const companyName = company.name;

  // Inline edits autosave with no toast, so the undo stack is the only thing
  // standing between the owner and a field they overwrote by accident. Each
  // save is its own batch (design/apple-hig-review.md, finding 3).
  async function patch(values: companiesRepo.CompanyPatch) {
    await writeWithUndo({
      label: `edited ${companyName}`,
      write: (batchId) => companiesRepo.update(id, values, { batchId }).then(() => undefined),
    });
    await invalidateRecords();
  }

  const archived = company.deletedAt !== null;
  const merged = mergedInto ?? null;

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        breadcrumb={
          <Link
            href="/companies"
            className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Companies
          </Link>
        }
        title={company.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-[var(--space-2)]">
            <span className="tabular">
              {[
                counts?.contacts === 0 || counts?.contacts === undefined
                  ? "No people yet"
                  : counts.contacts === 1
                    ? "1 person"
                    : `${counts.contacts} people`,
                counts?.openDeals === 0 || counts?.openDeals === undefined
                  ? `no open ${vocabulary.lowerMany}`
                  : counts.openDeals === 1
                    ? `1 open ${vocabulary.lower}`
                    : `${counts.openDeals} open ${vocabulary.lowerMany}`,
                !counts?.closedDeals
                  ? null
                  : counts.closedDeals === 1
                    ? `1 closed ${vocabulary.lower}`
                    : `${counts.closedDeals} closed ${vocabulary.lowerMany}`,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </span>
            {archived && merged ? (
              <span className="inline-flex items-center gap-[var(--space-2)]">
                <Badge tone="warning">Merged</Badge>
                <Link
                  href={`/companies/${merged.survivorId}`}
                  className="text-[length:var(--text-sm)] text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  Merged into {merged.survivorName}
                </Link>
              </span>
            ) : archived ? (
              <Badge tone="warning">Archived</Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            {/* A merge loser gets no Restore: its people, jobs and history moved
                to the survivor, so restoring would rebuild an empty duplicate
                (CPO audit, scenario 7). */}
            {archived && merged ? null : archived ? (
              <Button
                variant="secondary"
                onClick={() => {
                  void companiesRepo
                    .restore(id)
                    .then(invalidateRecords)
                    .catch((err: unknown) => reportError(err, "That company could not be restored."));
                }}
              >
                Restore
              </Button>
            ) : (
              <Button
                variant="destructive"
                iconLeft={<Trash size={16} weight="bold" aria-hidden="true" />}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-[var(--space-4)]">
        {company.phoneRaw ? (
          <Button
            variant="primary"
            className="tabular"
            iconLeft={<Phone size={16} weight="bold" aria-hidden="true" />}
            onClick={() =>
              void oneTap("call", company.phoneE164 ?? company.phoneRaw ?? "", { companyId: id }, {
                label: formatPhone(company.phoneRaw) || company.phoneRaw || "",
              })
            }
          >
            {formatPhone(company.phoneRaw) || company.phoneRaw}
          </Button>
        ) : (
          <span className="text-[length:var(--text-base)] text-[var(--color-text-faint)]">
            No phone number yet
          </span>
        )}

        {company.website ? (
          <a
            href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <Globe size={16} weight="regular" aria-hidden="true" />
            <span className="max-w-[260px] truncate" title={company.website}>
              {company.website}
            </span>
          </a>
        ) : null}

        {/* The AI action sits with the record's other actions rather than in
            the header: it renders its own "AI is off" sentence beside itself,
            and that sentence needs a line it can wrap onto. */}
        <SummarizeButton entityType="company" entityId={id} />
      </div>

      {/* Lifetime money, from src/db/repos/money.ts - the one definition of
          these figures (round 3, "Money model"). */}
      <CustomerMoneyStrip money={money} />

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <div>
            <CardGroupLabel>People</CardGroupLabel>
            <Card>
              {(contacts?.rows ?? []).length === 0 ? (
                <div className="p-[var(--space-4)]">
                  <EmptyState
                    title="Nobody linked yet"
                    description="Open a contact and set its company to this one, and the person shows up here."
                    action={
                      <Button variant="secondary" onClick={() => navigate("/contacts")}>
                        Go to contacts
                      </Button>
                    }
                  />
                </div>
              ) : (
                (contacts?.rows ?? []).map((contact) => (
                  <CardRow key={contact.id} interactive className="p-0">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="flex min-h-[var(--row-h)] w-full items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] text-[length:var(--text-base)] text-[var(--color-text)] no-underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
                    >
                      <span className="truncate" title={contactName(contact)}>
                        {contactName(contact)}
                      </span>
                    </Link>
                  </CardRow>
                ))
              )}
            </Card>
            <div className="mt-[var(--space-2)] flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<UserPlus size={16} weight="bold" aria-hidden="true" />}
                onClick={() => navigate("/contacts")}
              >
                Add someone
              </Button>
            </div>
          </div>

          <DealsCard
            title={`Open ${vocabulary.lowerMany}`}
            deals={openDeals?.rows ?? []}
            emptyText={`No open ${vocabulary.lowerMany} for this company.`}
          />
          <DealsCard
            title={`Closed ${vocabulary.lowerMany}`}
            deals={closedDeals?.rows ?? []}
            emptyText={`Nothing won or lost here yet.`}
          />

          <Timeline mergedForCompanyId={id} title="Timeline (everyone here)" />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <TaskRail companyId={id} />

          <div>
            <CardGroupLabel>Reminders</CardGroupLabel>
            <RecurringPanel
              companyId={id}
              aboutLabel={company.name}
              reference={todayLocal()}
            />
          </div>

          <div>
            <CardGroupLabel>Identity</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <InlineText
                  className="w-full"
                  label="Company name"
                  value={company.name}
                  onSave={(value) => patch({ name: value })}
                />
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Contact methods</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <InlineText
                  className="w-full"
                  label="Phone"
                  type="tel"
                  value={company.phoneRaw ?? ""}
                  placeholder="(801) 555-0147"
                  onSave={(value) => patch({ phone: value })}
                />
              </CardRow>
              <CardRow className="items-stretch">
                <InlineText
                  className="w-full"
                  label="Website"
                  value={company.website ?? ""}
                  placeholder="example.com"
                  onSave={(value) => patch({ website: value })}
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
                    htmlFor="company-source-field"
                    className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                  >
                    Source
                  </label>
                  <SourcePicker
                    id="company-source-field"
                    label="Source"
                    value={company.sourceId}
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
                    <TagEditor entityType="company" entityId={id} />
                  </div>
                </div>
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Address</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <AddressPanel
                    addressJson={company.addressJson}
                    link={{ companyId: id }}
                    onSave={(addressJson) => patch({ addressJson })}
                  />
                </div>
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Custom fields</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <div className="w-full">
                  <CustomFieldsPanel entityType="company" entityId={id} />
                </div>
              </CardRow>
            </Card>
          </div>

          <div>
            <CardGroupLabel>Notes</CardGroupLabel>
            <Card>
              <CardRow className="items-stretch">
                <InlineTextarea
                  className="w-full"
                  label="What to remember"
                  rows={5}
                  value={company.notes ?? ""}
                  onSave={(value) => patch({ notes: value })}
                />
              </CardRow>
            </Card>
          </div>

          <AttachmentList entityType="company" entityId={id} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${company.name}?`}
        description={`${company.name} moves to Trash and can be restored for 30 days. Its people and jobs stay, without a company.`}
        confirmLabel="Delete company"
        destructive
        onConfirm={async () => {
          try {
            await deleteWithUndo({
              label: company.name,
              remove: (batchId) => companiesRepo.softDelete(id, { batchId }),
              restore: (batchId) => companiesRepo.restore(id, { batchId }),
            });
            navigate("/companies");
          } catch (err) {
            reportError(err, "That company could not be deleted.");
          }
        }}
      />
    </div>
  );
}

