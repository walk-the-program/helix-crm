/**
 * The link a one-tap action opens. Pure and dependency-free so it can be unit
 * tested without React, sonner or the Tauri plugins: `oneTap.ts` does the
 * opening and the "Log it" offer.
 */
export type OneTapKind = "call" | "text" | "email" | "map";

/** `tel:` wants digits and a leading +, nothing else. */
export function telHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}

export function smsHref(value: string): string {
  return `sms:${value.replace(/[^\d+]/g, "")}`;
}

export function mailtoHref(value: string): string {
  return `mailto:${encodeURIComponent(value.trim())}`;
}

/** A map link is built from a whole address, so "map" has no value form here. */
export function hrefFor(kind: OneTapKind, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (kind === "call") return telHref(trimmed);
  if (kind === "text") return smsHref(trimmed);
  if (kind === "email") return mailtoHref(trimmed);
  return null;
}
