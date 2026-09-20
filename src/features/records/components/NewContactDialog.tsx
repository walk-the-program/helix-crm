/**
 * Creating a contact, with the duplicate warning the plan asks for: an email
 * or phone that already exists is a warning with a way in ("open it"), never
 * an error, because duplicates are allowed by policy.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { WarningCircle } from "@/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FormRow,
  Input,
} from "@/ui";
import * as contactsRepo from "@/db/repos/contacts";
import type { DuplicateWarning } from "@/db/errors";
import { useDebounced } from "@/features/records/lib/hooks";
import {
  invalidateRecords,
  newBatchId,
  offerUndoCreate,
  reportError,
} from "@/features/records/lib/mutations";

export function DuplicateNotice(props: {
  warnings: DuplicateWarning[];
  onOpen: (entityId: string) => void;
}) {
  if (props.warnings.length === 0) return null;
  const first = props.warnings[0];

  return (
    <div
      role="status"
      data-testid="duplicate-warning"
      className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-warning-ink)]"
    >
      <WarningCircle size={14} aria-hidden="true" className="mt-[3px] shrink-0" />
      <div className="min-w-0">
        <p>
          <span className="font-medium">{first.label}</span> already has that{" "}
          {first.matchedOn}. Open it instead of adding a second record?
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-[var(--space-2)]"
          onClick={() => props.onOpen(first.entityId)}
        >
          Open {first.label}
        </Button>
      </div>
    </div>
  );
}

export function NewContactDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (contactId: string) => void;
}) {
  const [, navigate] = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [warnings, setWarnings] = useState<DuplicateWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debouncedEmail = useDebounced(email, 300);
  const debouncedPhone = useDebounced(phone, 300);

  useEffect(() => {
    if (!props.open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setWarnings([]);
      setError(null);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const hasSomething =
      debouncedEmail.trim().length > 0 || debouncedPhone.trim().length > 0;
    if (!hasSomething) {
      setWarnings([]);
      return;
    }
    let cancelled = false;
    void contactsRepo
      .findDuplicates({
        emails: debouncedEmail.trim() ? [debouncedEmail] : [],
        phones: debouncedPhone.trim() ? [debouncedPhone] : [],
      })
      .then((found) => {
        if (!cancelled) setWarnings(found);
      })
      .catch(() => {
        if (!cancelled) setWarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedEmail, debouncedPhone, props.open]);

  async function create() {
    if (firstName.trim().length === 0 && lastName.trim().length === 0) {
      setError("Give the contact a name.");
      return;
    }
    setError(null);
    setSaving(true);
    const batchId = newBatchId();
    try {
      const contact = await contactsRepo.create(
        {
          firstName,
          lastName,
          emails: email.trim() ? [{ email, label: "work", isPrimary: true }] : [],
          phones: phone.trim() ? [{ raw: phone, label: "mobile", isPrimary: true }] : [],
        },
        { batchId },
      );
      await invalidateRecords();
      offerUndoCreate(batchId, contactsRepo.contactName(contact));
      props.onOpenChange(false);
      props.onCreated?.(contact.id);
    } catch (err) {
      reportError(err, "That contact did not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            A name is all that is required. Everything else can wait until after the call.
          </DialogDescription>
        </DialogHeader>

        {/* Round 3, criterion 10: the footer is a different zone from the form,
            so the step down to it is a whole size larger than the gap between
            two fields. Walker: "the email box next to Create Contact is just
            slightly too close". DialogFooter's own --space-6 is the floor;
            this is the breathing room on top of it. */}
        <FormRow className="pb-[var(--space-3)]">
          <div className="grid grid-cols-2 gap-[var(--space-4)]">
            <Field label="First name">
              <Input
                autoFocus
                value={firstName}
                placeholder="Brent"
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field label="Last name" error={error ?? undefined}>
              <Input
                value={lastName}
                placeholder="Hendrickson"
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Phone">
            <Input
              type="tel"
              value={phone}
              placeholder="(801) 555-0147"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>

          <Field label="Email">
            <Input
              type="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <DuplicateNotice
            warnings={warnings}
            onOpen={(id) => {
              props.onOpenChange(false);
              navigate(`/contacts/${id}`);
            }}
          />
        </FormRow>

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void create()}>
            {warnings.length > 0 ? "Create anyway" : "Create contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
