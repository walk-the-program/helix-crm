/**
 * Phones and emails on a contact.
 *
 * The phone number is the single most important thing on a record page
 * (DESIGN.md §3), so it is set large and it is a real control: one tap dials
 * through the OS opener and then offers a one-click "Log it" entry.
 *
 * Labels and the primary flag are edited in place. There is no
 * `updateEmail` in the emails repository, so changing an email's label or
 * primary flag is a remove followed by an add — two sequential repository
 * calls, never nested, because the write lock does not reenter. That gap is
 * recorded in STATUS under "Contract changes needed".
 */
import { useState } from "react";
import { Mail, MessageSquare, Phone, Plus, Star, Trash2 } from "lucide-react";
import { Badge, Button, IconButton, Input, Select, Tooltip } from "@/ui";
import * as contactsRepo from "@/db/repos/contacts";
import type { ContactEmail, ContactPhone } from "@/db/repos/contacts";
import { formatPhone } from "@/lib/phone";
import { oneTap } from "@/features/records/lib/oneTap";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

const PHONE_LABELS = ["mobile", "office", "home", "other"];
const EMAIL_LABELS = ["work", "personal", "billing", "other"];

function labelOptions(labels: string[], current: string) {
  const known = labels.includes(current) ? labels : [...labels, current];
  return known.map((label) => ({ value: label, label: label[0].toUpperCase() + label.slice(1) }));
}

/* -------------------------------------------------------------------------- */
/* phones                                                                     */
/* -------------------------------------------------------------------------- */

export function PhoneList(props: { contactId: string; phones: ContactPhone[] }) {
  const { contactId, phones } = props;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLabel, setDraftLabel] = useState("mobile");
  const [busy, setBusy] = useState(false);

  async function add() {
    const value = draft.trim();
    if (value.length === 0) return;
    setBusy(true);
    try {
      await contactsRepo.addPhone(contactId, {
        raw: value,
        label: draftLabel,
        isPrimary: phones.length === 0,
      });
      await invalidateRecords();
      setDraft("");
      setAdding(false);
    } catch (err) {
      reportError(err, "That phone number did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(phoneId: string) {
    try {
      for (const phone of phones) {
        if (phone.isPrimary && phone.id !== phoneId) {
          await contactsRepo.updatePhone(phone.id, { isPrimary: false });
        }
      }
      await contactsRepo.updatePhone(phoneId, { isPrimary: true });
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That did not save.");
    }
  }

  async function setLabel(phoneId: string, label: string) {
    try {
      await contactsRepo.updatePhone(phoneId, { label });
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That label did not save.");
    }
  }

  async function remove(phoneId: string) {
    try {
      await contactsRepo.removePhone(phoneId);
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That number did not come off.");
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {phones.length === 0 && !adding ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          No phone number yet. Without one you cannot call him back.
        </p>
      ) : null}

      {phones.map((phone) => (
        <div
          key={phone.id}
          data-testid="phone-row"
          className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--space-2)]"
        >
          <button
            type="button"
            data-testid="call-button"
            onClick={() =>
              void oneTap("call", phone.e164 ?? phone.raw, { contactId }, {
                label: formatPhone(phone.raw) || phone.raw,
              })
            }
            className={[
              "inline-flex min-h-[44px] w-full items-center gap-[var(--space-2)]",
              "rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-[var(--space-3)]",
              "tabular text-[length:var(--text-lg)] font-medium text-[var(--color-text)]",
              "hover:bg-[var(--color-hover)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            ].join(" ")}
          >
            <Phone size={20} aria-hidden="true" />
            {formatPhone(phone.raw) || phone.raw}
          </button>

          <div className="flex items-center gap-[var(--space-2)]">
            <div className="w-[108px] shrink-0">
              <label htmlFor={`phone-label-${phone.id}`} className="sr-only">
                Label for {formatPhone(phone.raw) || phone.raw}
              </label>
              <Select
                id={`phone-label-${phone.id}`}
                ariaLabel="Phone label"
                value={phone.label}
                options={labelOptions(PHONE_LABELS, phone.label)}
                onValueChange={(next) => void setLabel(phone.id, next)}
              />
            </div>

            {phone.e164 === null ? (
              <Tooltip content="Helix could not read this as a phone number, so it is stored exactly as typed.">
                <span>
                  <Badge tone="warning">Unverified</Badge>
                </span>
              </Tooltip>
            ) : null}

            {phone.isPrimary ? <Badge tone="neutral">Primary</Badge> : null}

            {/* A row's action cluster is the one place icon-only buttons are
                allowed, and each carries a label and a tooltip (DESIGN.md §10). */}
            <div className="ml-auto flex shrink-0 items-center gap-[var(--space-1)]">
              <Tooltip content="Send a text">
                <IconButton
                  label={`Text ${formatPhone(phone.raw) || phone.raw}`}
                  size="sm"
                  icon={<MessageSquare size={16} aria-hidden="true" />}
                  onClick={() =>
                    void oneTap("text", phone.e164 ?? phone.raw, { contactId }, {
                      label: formatPhone(phone.raw) || phone.raw,
                    })
                  }
                />
              </Tooltip>

              {phone.isPrimary ? null : (
                <Tooltip content="Make this the primary number">
                  <IconButton
                    label={`Make ${formatPhone(phone.raw) || phone.raw} the primary number`}
                    size="sm"
                    icon={<Star size={16} aria-hidden="true" />}
                    onClick={() => void makePrimary(phone.id)}
                  />
                </Tooltip>
              )}

              <Tooltip content="Remove this number">
                <IconButton
                  label={`Remove ${formatPhone(phone.raw) || phone.raw}`}
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => void remove(phone.id)}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-wrap items-end gap-[var(--space-2)]">
          <div>
            <label
              htmlFor="new-phone"
              className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              Phone number
            </label>
            <Input
              id="new-phone"
              autoFocus
              value={draft}
              placeholder="(801) 555-0147"
              className="w-[220px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(false);
                }
              }}
            />
          </div>
          <div className="w-[130px]">
            <label
              htmlFor="new-phone-label"
              className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              Label
            </label>
            <Select
              id="new-phone-label"
              ariaLabel="Label for the new phone number"
              value={draftLabel}
              options={labelOptions(PHONE_LABELS, draftLabel)}
              onValueChange={setDraftLabel}
            />
          </div>
          <Button variant="secondary" loading={busy} onClick={() => void add()}>
            Add number
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Plus size={16} aria-hidden="true" />}
            onClick={() => setAdding(true)}
          >
            Add a phone
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* emails                                                                     */
/* -------------------------------------------------------------------------- */

export function EmailList(props: { contactId: string; emails: ContactEmail[] }) {
  const { contactId, emails } = props;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLabel, setDraftLabel] = useState("work");
  const [busy, setBusy] = useState(false);

  async function add() {
    const value = draft.trim();
    if (value.length === 0) return;
    setBusy(true);
    try {
      await contactsRepo.addEmail(contactId, {
        email: value,
        label: draftLabel,
        isPrimary: emails.length === 0,
      });
      await invalidateRecords();
      setDraft("");
      setAdding(false);
    } catch (err) {
      reportError(err, "That email did not save.");
    } finally {
      setBusy(false);
    }
  }

  /** No updateEmail in the repository: remove then add the replacement. */
  async function replace(
    email: ContactEmail,
    next: { label?: string; isPrimary?: boolean },
  ) {
    try {
      if (next.isPrimary) {
        for (const other of emails) {
          if (other.isPrimary && other.id !== email.id) {
            await contactsRepo.removeEmail(other.id);
            await contactsRepo.addEmail(contactId, {
              email: other.emailLower,
              label: other.label,
              isPrimary: false,
            });
          }
        }
      }
      await contactsRepo.removeEmail(email.id);
      await contactsRepo.addEmail(contactId, {
        email: email.emailLower,
        label: next.label ?? email.label,
        isPrimary: next.isPrimary ?? email.isPrimary,
      });
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That did not save.");
    }
  }

  async function remove(emailId: string) {
    try {
      await contactsRepo.removeEmail(emailId);
      await invalidateRecords();
    } catch (err) {
      reportError(err, "That email did not come off.");
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {emails.length === 0 && !adding ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          No email address yet.
        </p>
      ) : null}

      {emails.map((email) => (
        <div
          key={email.id}
          data-testid="email-row"
          className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--space-2)]"
        >
          <button
            type="button"
            onClick={() => void oneTap("email", email.emailLower, { contactId })}
            className={[
              "inline-flex min-h-[44px] w-full items-center gap-[var(--space-2)]",
              "rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-[var(--space-3)]",
              "text-[length:var(--text-base)] text-[var(--color-text)]",
              "hover:bg-[var(--color-hover)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            ].join(" ")}
            title={email.emailLower}
          >
            <Mail size={20} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{email.emailLower}</span>
          </button>

          <div className="flex items-center gap-[var(--space-2)]">
            <div className="w-[108px] shrink-0">
              <label htmlFor={`email-label-${email.id}`} className="sr-only">
                Label for {email.emailLower}
              </label>
              <Select
                id={`email-label-${email.id}`}
                ariaLabel="Email label"
                value={email.label}
                options={labelOptions(EMAIL_LABELS, email.label)}
                onValueChange={(next) => void replace(email, { label: next })}
              />
            </div>

            {email.isPrimary ? <Badge tone="neutral">Primary</Badge> : null}

            <div className="ml-auto flex shrink-0 items-center gap-[var(--space-1)]">
              {email.isPrimary ? null : (
                <Tooltip content="Make this the primary email">
                  <IconButton
                    label={`Make ${email.emailLower} the primary email`}
                    size="sm"
                    icon={<Star size={16} aria-hidden="true" />}
                    onClick={() => void replace(email, { isPrimary: true })}
                  />
                </Tooltip>
              )}

              <Tooltip content="Remove this address">
                <IconButton
                  label={`Remove ${email.emailLower}`}
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => void remove(email.id)}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-wrap items-end gap-[var(--space-2)]">
          <div>
            <label
              htmlFor="new-email"
              className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              Email address
            </label>
            <Input
              id="new-email"
              autoFocus
              type="email"
              value={draft}
              placeholder="name@example.com"
              className="w-[280px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(false);
                }
              }}
            />
          </div>
          <div className="w-[130px]">
            <label
              htmlFor="new-email-label"
              className="block text-[length:var(--text-sm)] font-medium text-[var(--color-text-muted)]"
            >
              Label
            </label>
            <Select
              id="new-email-label"
              ariaLabel="Label for the new email address"
              value={draftLabel}
              options={labelOptions(EMAIL_LABELS, draftLabel)}
              onValueChange={setDraftLabel}
            />
          </div>
          <Button variant="secondary" loading={busy} onClick={() => void add()}>
            Add email
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Plus size={16} aria-hidden="true" />}
            onClick={() => setAdding(true)}
          >
            Add an email
          </Button>
        </div>
      )}
    </div>
  );
}
