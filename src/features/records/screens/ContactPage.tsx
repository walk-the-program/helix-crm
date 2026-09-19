/**
 * One contact.
 *
 * The header block is fixed by DESIGN.md §3 and does not negotiate: the name,
 * then the phone as a real control, then the next step, then at most two more
 * actions. Everything else — tags, the company link, the address, custom
 * fields, the source, the notes — lives below it, and the timeline scrolls.
 *
 * Nothing on this page has a save button. Every field autosaves.
 */
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArchiveRestore,
  ArrowLeft,
  Building2,
  PhoneCall,
  Mail,
  Trash2,
} from "lucide-react";
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
import * as contactsRepo from "@/db/repos/contacts";
import type { ActivityKind } from "@/db/repos/activities";
import { formatPhone } from "@/lib/phone";
import { useContact, useTasks } from "@/features/records/lib/hooks";
import {
  deleteWithUndo,
  invalidateRecords,
  reportError,
} from "@/features/records/lib/mutations";
import { oneTap } from "@/lib/actions";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { InlineText, InlineTextarea } from "@/features/records/components/InlineEdit";
import { CompanyPicker, SourcePicker } from "@/features/records/components/Pickers";
import { PhoneList, EmailList } from "@/features/records/components/ContactMethods";
import { AddressPanel } from "@/features/records/components/AddressPanel";
import { TagEditor } from "@/features/records/components/TagEditor";
import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";
import { Timeline } from "@/features/records/components/Timeline";
import { TaskRail } from "@/features/records/components/TaskRail";
import { AttachmentList } from "@/features/data/attachments/AttachmentList";

export function ContactPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: contact, isLoading } = useContact(id);
  const { data: openTasks } = useTasks({ contactId: id, openOnly: true }, 20);
  const [composing, setComposing] = useState<ActivityKind | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const nextTask = useMemo(() => (openTasks?.rows ?? [])[0] ?? null, [openTasks]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-6)]">
        <Spinner /> <span className="text-[var(--color-text-muted)]">Loading</span>
      </div>
    );
  }

  if (!contact) {
    return (
      <EmptyState
        title="That contact is gone"
        description="It may have been deleted or merged into another record."
        action={
          <Button variant="primary" onClick={() => navigate("/contacts")}>
            Back to contacts
          </Button>
        }
      />
    );
  }

  const name = contactsRepo.contactName(contact);
  const primaryPhone = contact.phones.find((phone) => phone.isPrimary) ?? contact.phones[0] ?? null;
  const primaryEmail = contact.emails.find((email) => email.isPrimary) ?? contact.emails[0] ?? null;
  const archived = contact.deletedAt !== null;

  async function patch(values: contactsRepo.ContactPatch) {
    await contactsRepo.update(id, values);
    await invalidateRecords();
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <Link
        href="/contacts"
        className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Contacts
      </Link>

      {/* The fixed top block: name, phone, next step, two actions. */}
      <section
        aria-label="Contact summary"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[length:var(--text-xl)] font-semibold text-[var(--color-text)]"
              title={name}
            >
              {name}
            </h1>
            {contact.companyId && contact.companyName ? (
              <Link
                href={`/companies/${contact.companyId}`}
                className="mt-[var(--space-1)] inline-flex max-w-full items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <Building2 size={16} aria-hidden="true" />
                <span className="truncate" title={contact.companyName}>
                  {contact.companyName}
                </span>
              </Link>
            ) : null}
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
                iconLeft={<ArchiveRestore size={20} aria-hidden="true" />}
                className="min-h-[44px]"
                onClick={() => {
                  void contactsRepo
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
                iconLeft={<Trash2 size={20} aria-hidden="true" />}
                className="min-h-[44px]"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
          {primaryPhone ? (
            <button
              type="button"
              data-testid="header-call"
              onClick={() =>
                void oneTap("call", primaryPhone.e164 ?? primaryPhone.raw, { contactId: id }, {
                  label: formatPhone(primaryPhone.raw) || primaryPhone.raw,
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
              <PhoneCall size={20} aria-hidden="true" />
              {formatPhone(primaryPhone.raw) || primaryPhone.raw}
            </button>
          ) : (
            <span className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
              No phone number yet
            </span>
          )}

          {primaryEmail ? (
            <Button
              variant="secondary"
              className="min-h-[44px]"
              iconLeft={<Mail size={20} aria-hidden="true" />}
              onClick={() => void oneTap("email", primaryEmail.emailLower, { contactId: id })}
            >
              Email
            </Button>
          ) : null}

          <Button
            variant="secondary"
            className="min-h-[44px]"
            iconLeft={<PhoneCall size={20} aria-hidden="true" />}
            onClick={() => setComposing("call")}
          >
            Log a call
          </Button>
        </div>

        <p className="mt-[var(--space-4)] text-[length:var(--text-base)]">
          <span className="text-[var(--color-text-muted)]">Next step: </span>
          {nextTask ? (
            <span className="text-[var(--color-text)]">
              {nextTask.title}{" "}
              <span className="tabular text-[var(--color-text-muted)]">
                · {dueLabel(nextTask)}
              </span>
            </span>
          ) : (
            <span className="font-medium text-[var(--color-accent-ink)]">No next step</span>
          )}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <Timeline
            fill
            contactId={id}
            composingKind={composing}
            onComposingKindChange={setComposing}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <TaskRail contactId={id} />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-[var(--space-5)]">
              <div className="grid grid-cols-2 gap-[var(--space-4)]">
                <InlineText
                  label="First name"
                  value={contact.firstName}
                  onSave={(value) => patch({ firstName: value })}
                />
                <InlineText
                  label="Last name"
                  value={contact.lastName}
                  onSave={(value) => patch({ lastName: value })}
                />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Phones
                </h3>
                <PhoneList contactId={id} phones={contact.phones} />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Emails
                </h3>
                <EmailList contactId={id} emails={contact.emails} />
              </div>

              <div className="flex flex-col gap-[var(--space-4)]">
                <div>
                  <label
                    htmlFor="contact-company"
                    className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                  >
                    Company
                  </label>
                  <CompanyPicker
                    id="contact-company"
                    label="Company"
                    value={contact.companyId}
                    onChange={(companyId) => {
                      void patch({ companyId }).catch((err: unknown) =>
                        reportError(err, "That did not save."),
                      );
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="contact-source"
                    className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
                  >
                    Source
                  </label>
                  <SourcePicker
                    id="contact-source"
                    label="Source"
                    value={contact.sourceId}
                    onChange={(sourceId) => {
                      void patch({ sourceId }).catch((err: unknown) =>
                        reportError(err, "That did not save."),
                      );
                    }}
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Tags
                </h3>
                <TagEditor entityType="contact" entityId={id} />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Address
                </h3>
                <AddressPanel
                  addressJson={contact.addressJson}
                  link={{ contactId: id }}
                  onSave={(addressJson) => patch({ addressJson })}
                />
              </div>

              <div>
                <h3 className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--color-text)]">
                  Custom fields
                </h3>
                <CustomFieldsPanel entityType="contact" entityId={id} />
              </div>

              <InlineTextarea
                label="Notes"
                rows={5}
                value={contact.notes ?? ""}
                placeholder="What you need to remember about this person."
                onSave={(value) => patch({ notes: value })}
              />
            </CardBody>
          </Card>

          <AttachmentList entityType="contact" entityId={id} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${name}?`}
        description={`${name} moves to Trash and can be restored for 30 days.`}
        confirmLabel="Delete contact"
        destructive
        onConfirm={async () => {
          try {
            await deleteWithUndo({
              label: name,
              remove: (batchId) => contactsRepo.softDelete(id, { batchId }),
              restore: (batchId) => contactsRepo.restore(id, { batchId }),
            });
            navigate("/contacts");
          } catch (err) {
            reportError(err, "That contact could not be deleted.");
          }
        }}
      />
    </div>
  );
}
