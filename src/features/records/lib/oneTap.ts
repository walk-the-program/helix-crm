/**
 * One-tap actions (PLAN.md item 12): every phone, email and address is a live
 * control. The link is built here (pure, unit-tested) and opened through the
 * OS opener, never by the webview. Each tap then offers a single-click "Log
 * it" so the call he just made lands on the timeline without a form.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "@/ui";
import * as activities from "@/db/repos/activities";
import { queryClient, qk } from "@/app/queryClient";
import { formatPhone } from "@/lib/phone";
import { hrefFor, type OneTapKind } from "@/features/records/lib/links";

export { hrefFor, mailtoHref, smsHref, telHref } from "@/features/records/lib/links";
export type { OneTapKind } from "@/features/records/lib/links";

/** Which record a logged action belongs to. */
export type RecordLink = {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
};

const LOG_BODY: Record<OneTapKind, (target: string) => string> = {
  call: (target) => `Called ${target}`,
  text: (target) => `Texted ${target}`,
  email: (target) => `Emailed ${target}`,
  map: (target) => `Looked up ${target}`,
};

const LOG_KIND: Record<OneTapKind, activities.ActivityKind> = {
  call: "call",
  text: "text",
  email: "email",
  map: "note",
};

function displayTarget(kind: OneTapKind, value: string): string {
  return kind === "call" || kind === "text" ? formatPhone(value) || value : value;
}

/** Write the timeline entry a one-tap action offers, and refresh the screen. */
export async function logOneTap(
  kind: OneTapKind,
  value: string,
  link: RecordLink,
): Promise<void> {
  const target = displayTarget(kind, value);
  await activities.create({
    kind: LOG_KIND[kind],
    body: LOG_BODY[kind](target),
    contactId: link.contactId ?? null,
    companyId: link.companyId ?? null,
    dealId: link.dealId ?? null,
  });
  await queryClient.invalidateQueries({ queryKey: ["activities"] });
  await queryClient.invalidateQueries({ queryKey: qk.today() });
  toast.success(`Logged: ${LOG_BODY[kind](target)}`);
}

/**
 * Hand the link to the OS, then offer the log entry. The toast is the offer:
 * one click, no dialog, and it disappears on its own if he is already driving.
 */
export async function oneTap(
  kind: OneTapKind,
  value: string,
  link: RecordLink,
  options: { href?: string | null; label?: string } = {},
): Promise<void> {
  const href = options.href ?? hrefFor(kind, value);
  if (!href) return;

  try {
    await openUrl(href);
  } catch (err) {
    toast.error(
      `Could not open ${options.label ?? displayTarget(kind, value)}. ${
        err instanceof Error ? err.message : ""
      }`.trim(),
    );
    return;
  }

  toast.info(`Opened ${options.label ?? displayTarget(kind, value)}`, {
    duration: 10000,
    action: {
      label: "Log it",
      onClick: () => {
        void logOneTap(kind, value, link).catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : "Could not write that to the timeline.",
          );
        });
      },
    },
  });
}
