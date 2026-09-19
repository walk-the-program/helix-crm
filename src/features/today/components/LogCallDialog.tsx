/**
 * "Log a call" — the note entry behind the one-tap button on New leads and
 * Gone quiet rows.
 *
 * It is a dialog rather than an inline field because the owner is typing what
 * was actually said, and that is the only thing on screen worth their
 * attention at that moment. It opens with the cursor in the box, Cmd/Ctrl+Enter
 * saves, Escape cancels, and saving with an empty box still writes the entry —
 * "I called them and they did not pick up" is worth recording and making the
 * owner invent a sentence first would mean they stop logging calls.
 */

import { useEffect, useRef, useState } from "react";
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

export type LogCallTarget = {
  /** The name shown in the title, e.g. "Rosalind Whitaker-Nguyen". */
  name: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
};

export function LogCallDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LogCallTarget | null;
  saving?: boolean;
  onSave: (body: string) => void | Promise<void>;
}) {
  const { open, onOpenChange, target, saving, onSave } = props;
  const [body, setBody] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) setBody("");
  }, [open, target?.dealId, target?.contactId]);

  if (!target) return null;

  const fallback = `Called ${target.name}.`;

  async function save() {
    const text = body.trim();
    await onSave(text.length > 0 ? text : fallback);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          boxRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Log a call with {target.name}</DialogTitle>
          <DialogDescription>
            This goes on their timeline with today&rsquo;s date and takes them off
            Today. Leave it blank if there is nothing to add.
          </DialogDescription>
        </DialogHeader>

        <Field label="What was said" htmlFor="today-log-call-body">
          <Textarea
            id="today-log-call-body"
            ref={boxRef}
            rows={4}
            value={body}
            placeholder="Wants the wall dropped to 4 ft, revised number by Friday"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            className="min-h-[120px] text-[length:var(--text-base)]"
          />
        </Field>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-[44px]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="min-h-[44px]"
            loading={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving the call" : "Save the call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
