/**
 * A stage change is a dated, confirmed event (D24): picking a stage - on the
 * deal page's stage picker, or dragging a card to a won/lost column on the
 * board - opens this rather than moving anything. Nothing changes until
 * Confirm: it only collects the date (default today) and, for a lost stage,
 * the reason, and hands them back through `onConfirm`. It never calls a
 * repository itself, so the caller decides what "confirmed" writes - the
 * board and the deal page each own their own `moveToStage` call.
 */
import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
} from "@/ui";
import { nowIso, parseDateOnly, todayLocal, toIso } from "@/lib/dates";

/**
 * A date-only string becomes an instant at local noon, well clear of any
 * day-boundary edge - the same convention the typed import uses for a
 * won/lost date read off a spreadsheet (`typedImportRun.ts`'s `closedAtFrom`).
 * The DatePicker only ever hands back a local "YYYY-MM-DD" string; this is
 * what turns it into the ISO timestamp `deal_stage_events.at` and
 * `stage_entered_at` store.
 */
function atFromDateOnly(dateOnly: string): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) return nowIso();
  parsed.setHours(12, 0, 0, 0);
  return toIso(parsed);
}

export function StageMoveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageName: string;
  /** True when the target stage is a lost stage: the reason is then required. */
  requiresReason: boolean;
  /** Prefill when the deal already carries a reason. */
  initialReason?: string | null;
  /**
   * A local "YYYY-MM-DD" to open the date on instead of today. Set when the
   * dialog is correcting a date rather than recording a new move, so the
   * owner sees what is currently stored before he changes it (F-LA-10).
   */
  initialDate?: string | null;
  /** Overrides the title; used by the "change the date" path. */
  title?: string;
  /** Overrides the confirm button's label. */
  confirmLabel?: string;
  /** ISO timestamp for the move, and the reason when one was asked for. */
  onConfirm: (result: { at: string; outcomeReason: string | null }) => void | Promise<void>;
}) {
  const [dateOnly, setDateOnly] = useState<string | null>(todayLocal());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialDate = props.initialDate ?? null;
  useEffect(() => {
    if (props.open) {
      setDateOnly(initialDate ?? todayLocal());
      setReason(props.initialReason ?? "");
      setError(null);
    }
  }, [props.open, props.initialReason, initialDate]);

  async function confirm() {
    if (!dateOnly) {
      setError("Pick a date.");
      return;
    }
    if (props.requiresReason && reason.trim().length === 0) {
      setError("Say why it was lost — price, timing, went with someone else.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await props.onConfirm({
        at: atFromDateOnly(dateOnly),
        outcomeReason: props.requiresReason ? reason.trim() : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{props.title ?? `Move to ${props.stageName}?`}</DialogTitle>
          <DialogDescription>Nothing changes until you confirm.</DialogDescription>
        </DialogHeader>

        <Field label="On" error={!props.requiresReason ? error ?? undefined : undefined}>
          <DatePicker
            value={dateOnly}
            onChange={setDateOnly}
            max={todayLocal()}
            aria-label={`Date the deal moved to ${props.stageName}`}
          />
        </Field>

        {props.requiresReason ? (
          <Field label="Reason" error={error ?? undefined}>
            <Textarea
              autoFocus
              rows={3}
              value={reason}
              placeholder="Went with a cheaper bid."
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void confirm();
                }
              }}
            />
          </Field>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void confirm()}>
            {props.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
