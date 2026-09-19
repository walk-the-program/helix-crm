/**
 * Losing a deal needs a reason: the repository refuses the move without one,
 * and the board asks here rather than showing the owner a validation error he
 * did not cause.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
} from "@/ui";

export function LostReasonDialog(props: {
  open: boolean;
  dealTitle: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setReason("");
      setError(null);
    }
  }, [props.open]);

  async function confirm() {
    if (reason.trim().length === 0) {
      setError("Say why it was lost — price, timing, went with someone else.");
      return;
    }
    setSaving(true);
    try {
      await props.onConfirm(reason.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Why was it lost?</DialogTitle>
          <DialogDescription>
            {props.dealTitle
              ? `${props.dealTitle} is moving to a lost stage. The reason is kept on the record.`
              : "The reason is kept on the record."}
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void confirm()}>
            Mark it lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
