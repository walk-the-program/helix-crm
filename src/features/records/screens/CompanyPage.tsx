/**
 * One company: its people, its open and closed jobs, and one merged timeline
 * that includes everything logged against its contacts — because the owner
 * remembers "that call with the HOA", not which of three board members he
 * happened to speak to.
 */
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Building2, Globe, Phone, Trash2, UserPlus } from "lucide-react";
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
import * as companiesRepo from "@/db/repos/companies";
import { contactName } from "@/db/repos/contacts";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { useVocabulary } from "@/app/vocabulary";
import {
  useCompany,
  useCompanyCounts,
  useContacts,
  useDeals,
} from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  reportError,
} from "@/features/records/lib/mutations";
import { oneTap } from "@/lib/actions";
import { InlineText, InlineTextarea } from "@/features/records/components/InlineEdit";
import { SourcePicker } from "@/features/records/components/Pickers";
import { AddressPanel } from "@/features/records/components/AddressPanel";
import { TagEditor } from "@/features/records/components/TagEditor";
import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";
import { Timeline } from "@/features/records/components/Timeline";
import { TaskRail } from "@/features/records/components/TaskRail";
import { AttachmentList } from "@/features/data/attachments/AttachmentList";

export function CompanyPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const vocabulary = useVocabulary();
  const { data: company, isLoading } = useCompany(id);
  const { data: counts } = useCompanyCounts(id);
  const { data: contacts } = useContacts({ companyId: id }, 500);
  const { data: openDeals } = useDeals({ companyId: id, openOnly: true }, 200);
  const { data: closedDeals } = useDeals({ companyId: id, closedOnly: true }, 200);
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

  async function patch(values: companiesRepo.CompanyPatch) {
    await companiesRepo.update(id, values);
    await invalidateRecords();
  }

  const archived = company.deletedAt !== null;

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <Link
        href="/companies"
        className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Companies
      </Link>

      <section
        aria-label="Company summary"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[length:var(--text-xl)] font-semibold text-[var(--color-text)]"
              title={company.name}
            >
              {company.name}
            </h1>
            <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] tabular text-[var(--color-text-muted)]">
              {counts?.contacts ?? 0} {counts?.contacts === 1 ? "person" : "people"} ·{" "}
              {counts?.openDeals ?? 0} open {vocabulary.lowerMany} · {counts?.closedDeals ?? 0}{" "}
              closed
            </p>
            {archived ? (
              <div className="mt-[var(--space-2)]">
                <Badge tone="warning">Archived</Badge>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-[var(--space-2)]">
            {archived ? (
              <Button
                variant="secondary"
                className="min-h-[44px]"
                onClick={() => {
                  void companiesRepo
                    .restore(id)
                    .then(invalidateRecords)
                    .catch((err: unknown) => reportError(err, "That did not restore."));
                }}
              >
                Restore
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="min-h-[44px]"
                iconLeft={<Trash2 size={20} aria-hidden="true" />}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
          {company.phoneRaw ? (
            <button
              type="button"
              onClick={() =>
                void oneTap("call", company.phoneE164 ?? company.phoneRaw ?? "", { companyId: id }, {
                  label: formatPhone(company.phoneRaw) || company.phoneRaw || "",
                })
              }
              className={[
                "inline-flex min-h-[44px] items-center gap-[var(--space-2)]",
                "rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
                "bg-[var(--color-surface-raised)] px-[var(--space-4)]",
                "tabular text-[length:var(--text-2xl)] font-medium text-[var(--color-text)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              ].join(" ")}
            >
              <Phone size={20} aria-hidden="true" />
              {formatPhone(company.phoneRaw) || company.phoneRaw}
            </button>
          ) : (
            <span className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
              No phone number yet
            </span>
          )}

          {company.website ? (
            <span className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              <Globe size={16} aria-hidden="true" />
              <span className="max-w-[260px] truncate" title={company.website}>
                {company.website}
              </span>
            </span>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <Card>
            <CardHeader>
              <CardTitle>People</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<UserPlus size={16} aria-hidden="true" />}
                onClick={() => navigate("/contacts")}
              >
                Add someone
              </Button>
            </CardHeader>
            <CardBody>
              {(contacts?.rows ?? []).length === 0 ? (
                <EmptyState
                  icon={<Building2 size={24} aria-hidden="true" />}
                  title="Nobody linked yet"
                  description="Open a contact and set its company to this one, and the person shows up here."
                  action={
                    <Button variant="primary" onClick={() => navigate("/contacts")}>
                      Go to contacts
                    </Button>
                  }
                />
              ) : (
                <ul className="flex flex-col">
                  {(contacts?.rows ?? []).map((contact) => (
                    <li key={contact.id} className="border-b border-[var(--color-border)] last:border-0">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="flex min-h-[44px] items-center justify-between gap-[var(--space-3)] px-[var(--space-1)] text-[length:var(--text-base)] text-[var(--color-text)] hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
                      >
                        <span className="truncate" title={contactName(contact)}>
                          {contactName(contact)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

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

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-[var(--space-5)]">
              <InlineText
                label="Company name"
                value={company.name}
                onSave={(value) => patch({ name: value })}
              />
              <InlineText
                label="Phone"
                type="tel"
                value={company.phoneRaw ?? ""}
                placeholder="(801) 555-0147"
                onSave={(value) => patch({ phone: value })}
              />
              <InlineText
                label="Website"
                value={company.website ?? ""}
                placeholder="example.com"
                onSave={(value) => patch({ website: value })}
              />

              <div>
                <label
                  htmlFor="company-source-field"
                  className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                >
                  Source
                </label>
                <SourcePicker
                  id="company-source-field"
                  label="Source"
                  value={company.sourceId}
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
                <TagEditor entityType="company" entityId={id} />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Address
                </h3>
                <AddressPanel
                  addressJson={company.addressJson}
                  link={{ companyId: id }}
                  onSave={(addressJson) => patch({ addressJson })}
                />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Custom fields
                </h3>
                <CustomFieldsPanel entityType="company" entityId={id} />
              </div>

              <InlineTextarea
                label="Notes"
                rows={5}
                value={company.notes ?? ""}
                onSave={(value) => patch({ notes: value })}
              />
            </CardBody>
          </Card>

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

function DealsCard(props: {
  title: string;
  deals: { id: string; title: string; valueCents: number; currency: string; stageName: string }[];
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{props.title}</CardTitle>
        <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {props.deals.length}
        </span>
      </CardHeader>
      <CardBody>
        {props.deals.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {props.emptyText}
          </p>
        ) : (
          <ul className="flex flex-col">
            {props.deals.map((deal) => (
              <li key={deal.id} className="border-b border-[var(--color-border)] last:border-0">
                <Link
                  href={`/deals/${deal.id}`}
                  className="flex min-h-[44px] items-center justify-between gap-[var(--space-3)] px-[var(--space-1)] hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
                >
                  <span className="min-w-0 truncate text-[length:var(--text-base)] text-[var(--color-text)]" title={deal.title}>
                    {deal.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-[var(--space-3)]">
                    <Badge>{deal.stageName}</Badge>
                    <span className="money text-[length:var(--text-base)] text-[var(--color-text)]">
                      {formatMoney(deal.valueCents, deal.currency)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
