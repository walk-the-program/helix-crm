/**
 * Paste to record (PLAN.md's "AI paste-to-record" flow).
 *
 *   paste -> Extract -> a form he can edit -> Confirm -> one transaction
 *
 * Three rules make this safe:
 *   - what the model returns lands in a form, never in the database. Confirm is
 *     the only thing that writes.
 *   - every field is editable, including the ones the model filled in.
 *   - a contact that already matches on email or phone is named before he
 *     confirms, so he chooses rather than discovers.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { AlertCircle, Sparkles, UserPlus } from "lucide-react";
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
  Textarea,
  toast,
} from "@/ui";
import { qk } from "@/app/queryClient";
import { parseMoneyToCents } from "@/lib/money";
import { AiParseError, aiErrorMessage } from "@/features/ai/errors";
import { AiReason } from "@/features/ai/components/AiGate";
import { runWithProvider, useAi } from "@/features/ai/lib/useAi";
import {
  createFromProposal,
  findDuplicateContact,
} from "@/features/ai/lib/proposal";
import type { ProposedRecord } from "@/features/ai/provider";

type Form = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  dealTitle: string;
  dealValue: string;
  dealExpectedOn: string;
};

const EMPTY_FORM: Form = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  notes: "",
  dealTitle: "",
  dealValue: "",
  dealExpectedOn: "",
};

function formFrom(proposal: ProposedRecord): Form {
  return {
    firstName: proposal.contact.firstName ?? "",
    lastName: proposal.contact.lastName ?? "",
    email: proposal.contact.email ?? "",
    phone: proposal.contact.phone ?? "",
    notes: [proposal.contact.notes, proposal.deal.summary]
      .filter((line): line is string => Boolean(line && line.trim()))
      .join("\n\n"),
    dealTitle: proposal.deal.title ?? "",
    dealValue: proposal.deal.value === null ? "" : String(proposal.deal.value),
    dealExpectedOn: proposal.deal.expectedOn ?? "",
  };
}

export function PasteToRecordDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the paste box, e.g. from a timeline entry. */
  initialText?: string;
}) {
  const { open, onOpenChange, initialText } = props;
  const client = useQueryClient();
  const ai = useAi();

  const [text, setText] = useState(initialText ?? "");
  const [form, setForm] = useState<Form | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawAnswer, setRawAnswer] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (open) return;
    // Closing throws the whole thing away: nothing half-confirmed survives.
    setText(initialText ?? "");
    setForm(null);
    setError(null);
    setRawAnswer(null);
    setDuplicate(null);
  }, [open, initialText]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...(current ?? EMPTY_FORM), [key]: value }));
  }

  async function onExtract() {
    if (!ai.workspaceId || !ai.config) return;
    const pasted = text.trim();
    if (pasted.length === 0) return;

    setExtracting(true);
    setError(null);
    setRawAnswer(null);
    try {
      const proposal = await runWithProvider(ai.workspaceId, ai.config, (provider) =>
        provider.extractRecord(pasted),
      );
      const next = formFrom(proposal);
      setForm(next);
      setDuplicate(
        await findDuplicateContact(next.email || null, next.phone || null),
      );
    } catch (err) {
      setError(aiErrorMessage(err));
      // AiParseError keeps the model's raw text so nothing the owner pasted,
      // and nothing he paid for, is lost.
      if (err instanceof AiParseError) setRawAnswer(err.raw);
      await ai.refresh();
    } finally {
      setExtracting(false);
    }
  }

  async function onConfirm() {
    if (!form) return;
    if (form.dealTitle.trim().length === 0) {
      setError("Give the job a title before saving it.");
      return;
    }
    if (form.firstName.trim().length === 0 && form.lastName.trim().length === 0) {
      setError("Give the customer a name before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createFromProposal({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        dealTitle: form.dealTitle,
        dealValueCents: parseMoneyToCents(form.dealValue) ?? 0,
        dealExpectedOn: form.dealExpectedOn.trim() || null,
      });
      await client.invalidateQueries({ queryKey: qk.contacts() });
      await client.invalidateQueries({ queryKey: qk.deals() });
      await client.invalidateQueries({ queryKey: qk.today() });
      onOpenChange(false);
      toast.success(`Added ${form.firstName} ${form.lastName}`.trim(), {
        action: {
          label: "Open",
          onClick: () => navigate(`/contacts/${result.contactId}`),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The shared DialogContent is centred and unbounded, so a form this tall
          runs its footer off the bottom of a short window. Cap it and scroll
          inside instead - the Save button has to stay reachable. */}
      <DialogContent
        size="lg"
        data-testid="ai-paste-dialog"
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Paste an email, a text or a voicemail</DialogTitle>
          <DialogDescription>
            Helix reads it and fills in a customer and a job. Nothing is saved until
            you press Save.
          </DialogDescription>
        </DialogHeader>

        {ai.disabledReason ? (
          <p
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)]"
            data-testid="ai-paste-disabled"
            role="status"
          >
            <AiReason reason={ai.disabledReason} />
          </p>
        ) : null}

        <FormRow>
          <Field label="The message">
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Hi, this is Dana Whitaker at 801-555-0147. Our sprinklers are flooding the driveway - can someone come look this week? Budget is around $600."
              data-testid="ai-paste-text"
            />
          </Field>
          <div>
            <Button
              variant={form ? "secondary" : "primary"}
              onClick={() => void onExtract()}
              loading={extracting}
              disabled={ai.disabledReason !== null || text.trim().length === 0}
              iconLeft={<Sparkles size={16} aria-hidden />}
              data-testid="ai-paste-extract"
            >
              {extracting ? "Reading…" : form ? "Read it again" : "Read it"}
            </Button>
          </div>
        </FormRow>

        {error ? (
          <p
            role="alert"
            data-testid="ai-paste-error"
            className="mt-[var(--space-4)] flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-danger-ink)]"
          >
            <AlertCircle size={16} aria-hidden className="mt-[2px] shrink-0" />
            {error}
          </p>
        ) : null}

        {rawAnswer ? (
          <details className="mt-[var(--space-2)]">
            <summary className="cursor-pointer text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              What it actually said
            </summary>
            <pre
              data-testid="ai-paste-raw"
              className="mt-[var(--space-2)] max-h-[180px] overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)] font-[var(--font-mono)] text-[length:var(--text-xs)] whitespace-pre-wrap"
            >
              {rawAnswer}
            </pre>
          </details>
        ) : null}

        {form ? (
          <div
            className="mt-[var(--space-6)] border-t border-[var(--color-border)] pt-[var(--space-5)]"
            data-testid="ai-paste-form"
          >
            <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
              Check this before it saves
            </h3>

            {duplicate ? (
              <p
                className="mt-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-warning-ink)]"
                data-testid="ai-paste-duplicate"
                role="status"
              >
                {duplicate.name} already has this email or phone number. Saving makes a
                second record.
              </p>
            ) : null}

            <div className="mt-[var(--space-4)] grid grid-cols-2 gap-[var(--space-4)]">
              <Field label="First name">
                <Input
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  data-testid="ai-first-name"
                />
              </Field>
              <Field label="Last name">
                <Input
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                  data-testid="ai-last-name"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(801) 555-0147"
                  data-testid="ai-phone"
                />
              </Field>
              <Field label="Email">
                <Input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  data-testid="ai-email"
                />
              </Field>
              <Field label="Job title">
                <Input
                  value={form.dealTitle}
                  onChange={(e) => set("dealTitle", e.target.value)}
                  data-testid="ai-deal-title"
                />
              </Field>
              <Field label="Value" hint="Leave it blank if the message does not say.">
                <Input
                  value={form.dealValue}
                  onChange={(e) => set("dealValue", e.target.value)}
                  placeholder="600"
                  data-testid="ai-deal-value"
                />
              </Field>
              <Field label="Expected date" hint="YYYY-MM-DD">
                <Input
                  value={form.dealExpectedOn}
                  onChange={(e) => set("dealExpectedOn", e.target.value)}
                  placeholder="2026-04-02"
                  data-testid="ai-deal-expected"
                />
              </Field>
            </div>

            <div className="mt-[var(--space-4)]">
              <Field label="Notes">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  data-testid="ai-notes"
                />
              </Field>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void onConfirm()}
            loading={saving}
            disabled={!form}
            iconLeft={<UserPlus size={16} aria-hidden />}
            data-testid="ai-paste-confirm"
          >
            Save customer and job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
