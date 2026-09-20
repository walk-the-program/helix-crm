/**
 * Paste to record (PLAN.md's "AI paste-to-record" flow).
 *
 *   paste -> Read it -> a form he can edit -> Save -> one transaction
 *
 * The sheet is a title, a sentence, one text area, and - once the model has
 * answered - the proposal as two grouped inset lists with the label on the
 * left and the field on the right. Save is the sheet's one primary button and
 * its one block of brand primary; Cancel is a ghost and "Read it" is a
 * secondary push button, because a sheet with two filled buttons in it has no
 * primary action at all.
 *
 * Three rules make this safe:
 *   - what the model returns lands in a form, never in the database. Save is
 *     the only thing that writes.
 *   - every field is editable, including the ones the model filled in.
 *   - a contact that already matches on email or phone is named before he
 *     saves, so he chooses rather than discovers.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { navigate } from "wouter/use-browser-location";
import { ICON_SIZE_SM, ICON_WEIGHT_STRONG, Sparkle, WarningCircle } from "@/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
  toast,
} from "@/ui";
import { qk } from "@/app/queryClient";
import { parseMoneyToCents } from "@/lib/money";
import {
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
} from "@/features/settings/components/SettingsLayout";
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
      {/* 680 is the form width, and DialogContent is
          already height-bound with its header and footer pinned, so a tall
          proposal scrolls inside the sheet and Save stays reachable. */}
      <DialogContent size="md" data-testid="ai-paste-dialog">
        <DialogHeader>
          <DialogTitle>Paste an email, a text or a voicemail</DialogTitle>
          <DialogDescription>
            Helix reads it and fills in a customer and a job. Nothing is saved until
            you press Save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          {ai.disabledReason ? (
            <p
              className="bg-[var(--color-accent-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]"
              data-testid="ai-paste-disabled"
              role="status"
            >
              <AiReason reason={ai.disabledReason} />
            </p>
          ) : null}

          <Field label="The message">
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Hi, this is Dana Whitaker at 801-555-0147. Our sprinklers are flooding the driveway - can someone come look this week? Budget is around $600."
              data-testid="ai-paste-text"
            />
          </Field>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => void onExtract()}
              loading={extracting}
              loadingLabel="Reading…"
              disabled={ai.disabledReason !== null || text.trim().length === 0}
              iconLeft={<Sparkle size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
              data-testid="ai-paste-extract"
            >
              {form ? "Read it again" : "Read it"}
            </Button>
          </div>

          {error ? (
            <p
              role="alert"
              data-testid="ai-paste-error"
              className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-danger-ink)]"
            >
              <WarningCircle size={ICON_SIZE_SM} aria-hidden className="flex-none" />
              {error}
            </p>
          ) : null}

          {rawAnswer ? (
            <details>
              <summary className="cursor-pointer text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                What it actually said
              </summary>
              <pre
                data-testid="ai-paste-raw"
                className="mt-[var(--space-2)] max-h-48 overflow-auto border border-[var(--color-border)] bg-[var(--color-accent-soft)] p-[var(--space-3)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] whitespace-pre-wrap"
              >
                {rawAnswer}
              </pre>
            </details>
          ) : null}

          {form ? (
            <div className="flex flex-col gap-[var(--space-5)]" data-testid="ai-paste-form">
              {duplicate ? (
                <SettingsNotice data-testid="ai-paste-duplicate">
                  {duplicate.name} already has this email or phone number. Saving makes a
                  second record.
                </SettingsNotice>
              ) : null}

              <SettingsGroup label="Customer">
                <SettingsRow label="First name" htmlFor="ai-first-name" field>
                  <Input
                    id="ai-first-name"
                    value={form.firstName}
                    onChange={(e) => set("firstName", e.target.value)}
                    data-testid="ai-first-name"
                  />
                </SettingsRow>
                <SettingsRow label="Last name" htmlFor="ai-last-name" field>
                  <Input
                    id="ai-last-name"
                    value={form.lastName}
                    onChange={(e) => set("lastName", e.target.value)}
                    data-testid="ai-last-name"
                  />
                </SettingsRow>
                <SettingsRow label="Phone" htmlFor="ai-phone" field>
                  <Input
                    id="ai-phone"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="(801) 555-0147"
                    data-testid="ai-phone"
                  />
                </SettingsRow>
                <SettingsRow label="Email" htmlFor="ai-email" field>
                  <Input
                    id="ai-email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    data-testid="ai-email"
                  />
                </SettingsRow>
              </SettingsGroup>

              <SettingsGroup label="Job">
                <SettingsRow label="Title" htmlFor="ai-deal-title" field>
                  <Input
                    id="ai-deal-title"
                    value={form.dealTitle}
                    onChange={(e) => set("dealTitle", e.target.value)}
                    data-testid="ai-deal-title"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Value"
                  hint="Leave it blank if the message does not say."
                  htmlFor="ai-deal-value"
                  field
                >
                  <Input
                    id="ai-deal-value"
                    value={form.dealValue}
                    onChange={(e) => set("dealValue", e.target.value)}
                    placeholder="600"
                    data-testid="ai-deal-value"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Expected date"
                  hint="Written as year-month-day."
                  htmlFor="ai-deal-expected"
                  field
                >
                  <Input
                    id="ai-deal-expected"
                    value={form.dealExpectedOn}
                    onChange={(e) => set("dealExpectedOn", e.target.value)}
                    placeholder="2026-04-02"
                    data-testid="ai-deal-expected"
                  />
                </SettingsRow>
              </SettingsGroup>

              <Field label="Notes">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  data-testid="ai-notes"
                />
              </Field>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void onConfirm()}
            loading={saving}
            loadingLabel="Saving…"
            disabled={!form}
            data-testid="ai-paste-confirm"
          >
            Save customer and job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
