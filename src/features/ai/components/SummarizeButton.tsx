/**
 * "Summarise": three or four sentences about one record and its timeline, so
 * the owner can pick up a job he has not touched in a month.
 *
 * The sheet holds one paragraph and two buttons: Close as the ghost, and Copy
 * as the black one, because copying it somewhere he can use it is the only
 * thing this sheet is for (docs/DESIGN.md section 9).
 *
 * The summary is shown and can be copied. It is never written into the record:
 * a model's paragraph is not a fact about the customer, and the timeline is the
 * thing this business runs on.
 */
import { useState } from "react";
import { Copy, ICON_SIZE_SM, ICON_WEIGHT_STRONG, ScrollText } from "@/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from "@/ui";
import { aiErrorMessage } from "@/features/ai/errors";
import { AiActionButton } from "@/features/ai/components/AiGate";
import { runWithProvider, useAi } from "@/features/ai/lib/useAi";
import { recordContext, type AiEntityType } from "@/features/ai/lib/context";

export function SummarizeButton(props: {
  entityType: AiEntityType;
  entityId: string;
}) {
  const { entityType, entityId } = props;
  const ai = useAi();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSummarize() {
    if (!ai.workspaceId || !ai.config) return;
    setBusy(true);
    setError(null);
    setSummary("");
    setOpen(true);
    try {
      const context = await recordContext(entityType, entityId);
      if (!context) {
        setError("That record is no longer here.");
        return;
      }
      const text = await runWithProvider(ai.workspaceId, ai.config, (provider) =>
        provider.summarize(context.record, context.timeline),
      );
      setSummary(text);
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
        label="Summarise"
        loadingLabel="Reading…"
        disabledReason={ai.disabledReason}
        busy={busy && !open}
        onClick={() => void onSummarize()}
        icon={<ScrollText size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
        testId="ai-summarize"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" data-testid="ai-summary-dialog">
          <DialogHeader>
            <DialogTitle>Summary</DialogTitle>
            <DialogDescription>
              Written from this record and its history. Nothing is saved to the record.
            </DialogDescription>
          </DialogHeader>

          {busy ? (
            <Spinner label="Reading the record" />
          ) : error ? (
            <p
              role="alert"
              data-testid="ai-summary-error"
              className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]"
            >
              {error}
            </p>
          ) : (
            <p
              data-testid="ai-summary-text"
              className="whitespace-pre-wrap text-[length:var(--text-base)] leading-[var(--leading-normal)] text-[var(--color-text)]"
            >
              {summary}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              iconLeft={<Copy size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden />}
              disabled={summary.length === 0}
              onClick={() => {
                void navigator.clipboard
                  .writeText(summary)
                  .then(() => toast.success("Copied the summary"))
                  .catch(() => toast.error("The clipboard refused it."));
              }}
              data-testid="ai-summary-copy"
            >
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
