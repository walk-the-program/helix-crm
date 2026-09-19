/**
 * "Draft a follow-up": one deal, its timeline, and a short email the owner can
 * copy or open in his mail app.
 *
 * The sheet is a title, a sentence, and two fields. Cancel is the ghost button,
 * Copy is a default push button, and "Open in Mail" is the one black button -
 * the thing he came to the sheet to do (docs/DESIGN.md section 9).
 *
 * Nothing is sent from Helix. The draft opens in whatever mail app the OS uses,
 * through a mailto: URL and the opener plugin, so the owner reads it in his own
 * outbox before anyone else sees it. Email sending is out of scope for v1
 * (PLAN.md, "NOT in scope"), and this is the line that keeps it that way.
 */
import { useState } from "react";
import { Copy, ICON_SIZE_SM, ICON_WEIGHT_STRONG, Mail, PenLine } from "@/ui/icons";
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
import { aiErrorMessage } from "@/features/ai/errors";
import { AiActionButton, AiReason } from "@/features/ai/components/AiGate";
import { runWithProvider, useAi } from "@/features/ai/lib/useAi";
import { dealContext } from "@/features/ai/lib/context";

async function openInMail(to: string | null, subject: string, body: string) {
  const url = `mailto:${to ?? ""}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  } catch {
    window.location.href = url;
  }
}

export function DraftFollowUpButton(props: {
  dealId: string;
  /** The customer's address, when the caller has it, so mailto: is prefilled. */
  email?: string | null;
}) {
  const { dealId, email = null } = props;
  const ai = useAi();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onDraft() {
    if (!ai.workspaceId || !ai.config) return;
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      const context = await dealContext(dealId);
      if (!context) {
        setError("That job is no longer here.");
        return;
      }
      const draft = await runWithProvider(ai.workspaceId, ai.config, (provider) =>
        provider.draftFollowUp(context.deal, context.timeline),
      );
      setSubject(draft.subject);
      setBody(draft.body);
    } catch (err) {
      setError(aiErrorMessage(err));
      await ai.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AiActionButton
        label="Draft a follow-up"
        loadingLabel="Drafting…"
        disabledReason={ai.disabledReason}
        busy={busy && !open}
        onClick={() => void onDraft()}
        icon={<PenLine size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
        testId="ai-draft-followup"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" data-testid="ai-draft-dialog">
          <DialogHeader>
            <DialogTitle>Follow-up draft</DialogTitle>
            <DialogDescription>
              Read it, change what you want, then copy it or open it in your mail app.
              Helix never sends anything.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-[var(--space-4)]">
            {error ? (
              <p
                role="alert"
                data-testid="ai-draft-error"
                className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]"
              >
                {error}
              </p>
            ) : null}

            {ai.disabledReason ? <AiReason reason={ai.disabledReason} /> : null}

            <Field label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                data-testid="ai-draft-subject"
              />
            </Field>

            <Field label="Message">
              <Textarea
                rows={10}
                value={busy ? "Drafting…" : body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="ai-draft-body"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              iconLeft={<Copy size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
              disabled={body.length === 0}
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${subject}\n\n${body}`)
                  .then(() => toast.success("Copied the draft"))
                  .catch(() => toast.error("The clipboard refused it."));
              }}
              data-testid="ai-draft-copy"
            >
              Copy
            </Button>
            <Button
              variant="primary"
              iconLeft={<Mail size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
              disabled={body.length === 0}
              onClick={() => void openInMail(email, subject, body)}
              data-testid="ai-draft-mail"
            >
              Open in Mail
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
