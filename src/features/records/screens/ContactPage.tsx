/**
 * One contact.
 *
 * The hierarchy is fixed by DESIGN.md §3 and does not negotiate: the name, then
 * the phone as a real control, then the next step, then at most two more
 * actions. Everything else — tags, the company link, the address, custom
 * fields, the notes — lives below it in grouped inset lists, and the timeline
 * scrolls beside them.
 *
 * The summary block is not a card. A bordered panel sitting directly under the
 * toolbar was the thing that made this page read as a web dashboard; a native
 * record pane puts its title in the open air, with space rather than a rule
 * separating it from what follows (DESIGN.md §9 "Page header").
 *
 * "Call" is the one filled button on the page, and its label is the number
 * itself in tabular figures, because dialling is what the owner opened this
 * record to do. Nothing on this page has a save button — every field autosaves.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  Archive,
  ArrowLeft,
  Buildings,
  ChatText,
  Envelope,
  PhoneCall,
  Trash,
} from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardGroupLabel,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Spinner,
} from "@/ui";
import * as contactsRepo from "@/db/repos/contacts";
import type { ActivityKind } from "@/db/repos/activities";
import { formatPhone } from "@/lib/phone";
import { SummarizeButton } from "@/features/ai";
import {
  useContact,
  useCustomerMoney,
  useDeals,
  useMergedInto,
  useTasks,
} from "@/features/records/lib/hooks";
import * as dealsRepo from "@/db/repos/deals";
import { useVocabulary } from "@/app/vocabulary";
import { useFormats } from "@/app/formats";
import {
  deleteWithUndo,
  invalidateRecords,
  writeWithUndo,
  reportError,
} from "@/features/records/lib/mutations";
import { oneTap } from "@/lib/actions";
import { dueLabel } from "@/features/records/lib/taskGroups";
import { todayLocal } from "@/lib/dates";
import { InlineText, InlineTextarea } from "@/features/records/components/InlineEdit";
import { CompanyPicker, SourcePicker } from "@/features/records/components/Pickers";
import { CustomerMoneyStrip } from "@/features/records/components/MoneyStrip";
import { DealsCard } from "@/features/records/components/DealsCard";
import { PhoneList, EmailList } from "@/features/records/components/ContactMethods";
import { AddressPanel } from "@/features/records/components/AddressPanel";
import { TagEditor } from "@/features/records/components/TagEditor";
import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";
import { Timeline } from "@/features/records/components/Timeline";
import { TaskRail } from "@/features/records/components/TaskRail";
import { AttachmentList } from "@/features/data/attachments/AttachmentList";
import { RecurringPanel } from "@/features/recurring";
import { SendSplitButton } from "@/features/templates/components/SendSplitButton";

/** One labelled group of fields: the small-capitals label, then the panel. */
function Group(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <CardGroupLabel>{props.label}</CardGroupLabel>
      <Card>{props.children}</Card>
    </div>
  );
}

/** A picker's label, matching the kit's field label exactly. */
const fieldLabel =
  "block pb-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]";

export function ContactPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: contact, isLoading } = useContact(id);
  // This person's own money, not their company's: two contacts at the same
  // company must not each appear to be worth the company's whole history.
  const { data: money } = useCustomerMoney({ contactId: id });
  const { data: openTasks } = useTasks({ contactId: id, openOnly: true }, 20);
  const vocabulary = useVocabulary();
  const formats = useFormats();
  const { data: openDeals } = useDeals({ contactId: id, openOnly: true }, 200);
  const { data: closedDeals } = useDeals({ contactId: id, closedOnly: true }, 200);
  const { data: mergedInto } = useMergedInto("contact", id, contact?.deletedAt != null);
  const [composing, setComposing] = useState<ActivityKind | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * A pending company change, waiting on the question below.
   *
   * Moving a contact to another company used to write one column and stop
   * there: their open jobs kept the old company_id, and so did the documents
   * raised against those jobs, because `documents.syncCustomerFromDeal` only
   * runs from `deals.update`. The job was then invoiced and reported against a
   * company the customer had left, silently (CPO audit, F-LA-4).
   */
  const [pendingCompany, setPendingCompany] = useState<{
    companyId: string | null;
  } | null>(null);

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
        title="That contact is not here"
        description="They may be in the Trash, or they may have been merged into another record."
        action={
          <>
            <Button variant="primary" onClick={() => navigate("/contacts")}>
              Back to contacts
            </Button>
            <Button variant="secondary" onClick={() => navigate("/trash")}>
              Open Trash
            </Button>
          </>
        }
      />
    );
  }

  const name = contactsRepo.contactName(contact);
  const primaryPhone = contact.phones.find((phone) => phone.isPrimary) ?? contact.phones[0] ?? null;
  const primaryEmail = contact.emails.find((email) => email.isPrimary) ?? contact.emails[0] ?? null;
  const archived = contact.deletedAt !== null;
  const openCount = openDeals?.rows.length ?? 0;
  const merged = mergedInto ?? null;
  const phoneLabel = primaryPhone
    ? formatPhone(primaryPhone.raw) || primaryPhone.raw
    : null;

  // Inline edits autosave with no toast, so the undo stack is the only thing
  // standing between the owner and a field they overwrote by accident. Each
  // save is its own batch (design/apple-hig-review.md, finding 3).
  async function patch(values: contactsRepo.ContactPatch) {
    await writeWithUndo({
      label: `edited ${name}`,
      write: (batchId) => contactsRepo.update(id, values, { batchId }).then(() => undefined),
    });
    await invalidateRecords();
  }

  return (
    <div className="flex flex-col">
      {/* The header block: breadcrumb, name, where he works, the actions. */}
      <header
        aria-label="Contact summary"
        className="flex flex-col gap-[var(--space-4)] pb-[var(--space-6)]"
      >
        <div className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
          <div className="min-w-0 flex-1">
            <Link
              href="/contacts"
              className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
            >
              <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Contacts
            </Link>
            <h1
              className="truncate"
              title={name}
            >
              {name}
            </h1>
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              {contact.companyId && contact.companyName ? (
                <Link
                  href={`/companies/${contact.companyId}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  <Buildings size={16} weight="regular" aria-hidden="true" />
                  <span className="truncate" title={contact.companyName}>
                    {contact.companyName}
                  </span>
                </Link>
              ) : null}
              {archived && merged ? (
                <span className="inline-flex items-center gap-[var(--space-2)]">
                  <Badge tone="warning">Merged</Badge>
                  <Link
                    href={`/contacts/${merged.survivorId}`}
                    className="text-[length:var(--text-sm)] text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                  >
                    Merged into {merged.survivorName}
                  </Link>
                </span>
              ) : archived ? (
                <Badge tone="warning">Archived</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-none items-center gap-[var(--space-2)]">
            {/* A merge loser gets no Restore: everything this person owned moved
                to the survivor, so restoring would rebuild an empty duplicate
                of someone who already exists. Undoing a merge is the merge's
                own reversal, not this button (CPO audit, scenario 7). */}
            {archived && merged ? null : archived ? (
              <Button
                variant="secondary"
                iconLeft={<Archive size={16} weight="bold" aria-hidden="true" />}
                onClick={() => {
                  void contactsRepo
                    .restore(id)
                    .then(invalidateRecords)
                    .catch((err: unknown) => reportError(err, "That contact could not be restored."));
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
          </div>
        </div>

        {/* The phone first, as the one filled control on the page. */}
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {primaryPhone && phoneLabel ? (
            <Button
              variant="primary"
              data-testid="header-call"
              className="tabular"
              iconLeft={<PhoneCall size={16} weight="bold" aria-hidden="true" />}
              onClick={() =>
                void oneTap("call", primaryPhone.e164 ?? primaryPhone.raw, { contactId: id }, {
                  label: phoneLabel,
                })
              }
            >
              {phoneLabel}
            </Button>
          ) : (
            <span className="text-[length:var(--text-base)] text-[var(--color-text-faint)]">
              No phone number yet
            </span>
          )}

          {/* Text and Email are split buttons: the left half does what it
              always did, and the caret picks a saved template, renders it for
              this customer and opens the message with the words in it. */}
          {primaryPhone && phoneLabel ? (
            <SendSplitButton
              kind="text"
              to={primaryPhone.e164 ?? primaryPhone.raw}
              target={{ contactId: id }}
              contactId={id}
              label="Text"
              icon={<ChatText size={16} weight="bold" aria-hidden="true" />}
            />
          ) : null}

          {primaryEmail ? (
            <SendSplitButton
              kind="email"
              to={primaryEmail.emailLower}
              target={{ contactId: id }}
              contactId={id}
              label="Email"
              icon={<Envelope size={16} weight="bold" aria-hidden="true" />}
            />
          ) : null}

          <Button
            variant="ghost"
            iconLeft={<PhoneCall size={16} weight="bold" aria-hidden="true" />}
            onClick={() => setComposing("call")}
          >
            Log a call
          </Button>

          {/* The AI action sits with the record's other actions rather than in
              the header: it renders its own "AI is off" sentence beside itself,
              and that sentence needs a line it can wrap onto. */}
          <SummarizeButton entityType="contact" entityId={id} />
        </div>

        {/* Then the promise. Never in an accent colour: "needs you" on this
            page is the fact that the sentence is third from the top. */}
        <p className="text-[length:var(--text-base)]">
          <span className="text-[var(--color-text-muted)]">Next step: </span>
          {nextTask ? (
            <span className="text-[var(--color-text)]">
              {nextTask.title}{" "}
              <span className="tabular text-[var(--color-text-muted)]">
                · {dueLabel(nextTask, undefined, formats.locale)}
              </span>
            </span>
          ) : (
            <span className="text-[var(--color-text-faint)]">none yet</span>
          )}
        </p>

        {/* Lifetime money, from src/db/repos/money.ts - the one definition of
            these figures (round 3, "Money model"). */}
        <CustomerMoneyStrip money={money} />
      </header>

      <div className="grid grid-cols-1 gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* self-start: the grid row is as tall as the details column, and a
            timeline stretched to 1900px with one empty state in the middle
            of it is a void, not a layout. */}
        <div className="min-w-0 xl:self-start">
          <Timeline
            contactId={id}
            composingKind={composing}
            onComposingKindChange={setComposing}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <TaskRail contactId={id} />

          <div>
            <CardGroupLabel>Reminders</CardGroupLabel>
            <RecurringPanel contactId={id} aboutLabel={name} reference={todayLocal()} />
          </div>

          <DealsCard
            title={`Open ${vocabulary.lowerMany}`}
            deals={openDeals?.rows ?? []}
            emptyText={`Nothing open for ${name} right now.`}
          />
          <DealsCard
            title={`Closed ${vocabulary.lowerMany}`}
            deals={closedDeals?.rows ?? []}
            emptyText="Nothing won or lost yet."
          />

          <Group label="Details">
            <CardBody className="flex flex-col gap-[var(--space-4)]">
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
                <label htmlFor="contact-company" className={fieldLabel}>
                  Company
                </label>
                <CompanyPicker
                  id="contact-company"
                  label="Company"
                  value={contact.companyId}
                  onChange={(companyId) => {
                    // With open jobs on the person, moving them is a decision
                    // about the jobs too, so ask once rather than leaving the
                    // two records disagreeing (F-LA-4).
                    if ((openDeals?.rows ?? []).length > 0) {
                      setPendingCompany({ companyId });
                      return;
                    }
                    void patch({ companyId }).catch((err: unknown) =>
                      reportError(err, "That change did not save."),
                    );
                  }}
                />
              </div>
              <div>
                <label htmlFor="contact-source" className={fieldLabel}>
                  Source
                </label>
                <SourcePicker
                  id="contact-source"
                  label="Source"
                  value={contact.sourceId}
                  onChange={(sourceId) => {
                    void patch({ sourceId }).catch((err: unknown) =>
                      reportError(err, "That change did not save."),
                    );
                  }}
                />
              </div>
            </CardBody>
          </Group>

          <div>
            <CardGroupLabel>Phones</CardGroupLabel>
            <PhoneList contactId={id} phones={contact.phones} />
          </div>

          <div>
            <CardGroupLabel>Emails</CardGroupLabel>
            <EmailList contactId={id} emails={contact.emails} />
          </div>

          <Group label="Tags">
            <CardBody>
              <TagEditor entityType="contact" entityId={id} />
            </CardBody>
          </Group>

          <Group label="Address">
            <CardBody>
              <AddressPanel
                addressJson={contact.addressJson}
                link={{ contactId: id }}
                onSave={(addressJson) => patch({ addressJson })}
              />
            </CardBody>
          </Group>

          <Group label="Custom fields">
            <CardBody>
              <CustomFieldsPanel entityType="contact" entityId={id} />
            </CardBody>
          </Group>

          <Group label="Notes">
            <CardBody>
              <InlineTextarea
                label="What to remember"
                rows={5}
                value={contact.notes ?? ""}
                placeholder="What you need to remember about this person."
                onSave={(value) => patch({ notes: value })}
              />
            </CardBody>
          </Group>

          <AttachmentList entityType="contact" entityId={id} />
        </div>
      </div>

      {/* Three honest answers, not two: moving the jobs is the usual one, but
          a contact who genuinely changed employer mid-quote keeps the old
          company on the old work, and cancelling leaves everything alone. */}
      <Dialog
        open={pendingCompany !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCompany(null);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              Move {name}&rsquo;s {openCount === 1 ? vocabulary.lower : vocabulary.lowerMany} as
              well?
            </DialogTitle>
            <DialogDescription>
              {name} has {openCount} open{" "}
              {openCount === 1 ? vocabulary.lower : vocabulary.lowerMany}. Moving them keeps the
              work with the customer. Anything already won or lost stays where it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingCompany(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const next = pendingCompany;
                setPendingCompany(null);
                if (!next) return;
                void patch({ companyId: next.companyId }).catch((err: unknown) =>
                  reportError(err, "That change did not save."),
                );
              }}
            >
              Just the contact
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const next = pendingCompany;
                setPendingCompany(null);
                if (!next) return;
                try {
                  // One batch across the contact and every open job, so a
                  // single Cmd+Z puts all of it back. Each job goes through
                  // `deals.update`, which is what re-syncs its documents.
                  await writeWithUndo({
                    label: `moved ${name} and their open ${vocabulary.lowerMany}`,
                    write: async (batchId) => {
                      await contactsRepo.update(id, { companyId: next.companyId }, { batchId });
                      for (const deal of openDeals?.rows ?? []) {
                        await dealsRepo.update(
                          deal.id,
                          { companyId: next.companyId },
                          { batchId },
                        );
                      }
                    },
                  });
                  await invalidateRecords();
                } catch (err) {
                  reportError(err, "That change did not save.");
                }
              }}
            >
              Move the {vocabulary.lowerMany} too
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
