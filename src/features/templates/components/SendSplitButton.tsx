/**
 * The Text and Email actions on a contact, as split buttons.
 *
 * Left half: what the button always did - open Messages or the mail app on this
 * customer with nothing written. Right half: a caret that lists the templates
 * of that kind, renders one against this customer and opens the message with
 * the words already in it.
 *
 * The owner still presses send. Helix writes the message and hands it to the
 * app he already uses; it never sends anything itself, and it never writes the
 * timeline entry either until he says the conversation happened - opening a
 * text is not proof that anybody replied.
 *
 * Two hairlines make the split: the two halves are one control, so the caret
 * shares the button's border and the seam between them is a single hairline
 * rather than a gap.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { CaretDown } from "@/ui/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@/ui";
import { navigate } from "wouter/use-browser-location";
import { oneTap, openMailto, openSms } from "@/lib/actions";
import type { ActionTarget } from "@/lib/actions";
import { renderTemplate } from "@/features/templates/lib/merge";
import { valuesForContact } from "@/features/templates/lib/values";
import { useTemplates } from "@/features/templates/lib/hooks";
import type { Template, TemplateKind } from "@/db/repos/templates";

export function SendSplitButton(props: {
  kind: TemplateKind;
  /** The phone number or email address to send to. */
  to: string;
  /** Which record the timeline entry belongs to. */
  target: ActionTarget;
  /** The contact whose values fill the merge fields. */
  contactId: string;
  label: string;
  icon: ReactNode;
  /** Passed to the plain half, so a phone number can show in tabular figures. */
  className?: string;
}) {
  const { kind, to, target, contactId, label, icon, className } = props;
  const { data: templates } = useTemplates(kind);
  const [busy, setBusy] = useState(false);
  const rows: Template[] = templates ?? [];

  async function sendPlain() {
    await oneTap(kind === "text" ? "text" : "email", to, target);
  }

  async function sendTemplate(template: Template) {
    setBusy(true);
    try {
      const values = await valuesForContact(contactId);
      const body = renderTemplate(template.body, values);
      const subject = template.subject ? renderTemplate(template.subject, values) : undefined;

      const result =
        kind === "text"
          ? await openSms(to, target, { body })
          : await openMailto(to, target, { subject, body });

      toast.info(`Opened "${template.name}"`, {
        duration: 12000,
        action: { label: result.logLabel, onClick: () => void result.logThis() },
      });
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : `Could not open ${to}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-stretch" data-testid={`send-split-${kind}`}>
      <Button
        type="button"
        variant="secondary"
        iconLeft={icon}
        loading={busy}
        loadingLabel="Opening"
        className={["border-r-0", className ?? ""].join(" ")}
        onClick={() => void sendPlain()}
      >
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            aria-label={`Pick ${kind === "text" ? "a text" : "an email"} template for ${to}`}
            className="px-[var(--space-2)]"
          >
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {kind === "text" ? "Text templates" : "Email templates"}
          </DropdownMenuLabel>
          {rows.length === 0 ? (
            <DropdownMenuItem disabled>Nothing saved yet</DropdownMenuItem>
          ) : (
            rows.map((template) => (
              <DropdownMenuItem
                key={template.id}
                onSelect={() => void sendTemplate(template)}
              >
                {template.name}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/settings/templates")}>
            Edit templates
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
