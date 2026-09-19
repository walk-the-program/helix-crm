// Pure email normalisation and pragmatic (not RFC-exhaustive) validation.
//
// `lower` backs the `email_lower` database column used as the dedupe key.

export type NormalizedEmail = { raw: string; lower: string; valid: boolean };

export function normalizeEmail(input: string): NormalizedEmail {
  const raw = input.trim();
  if (raw === "") {
    return { raw: "", lower: "", valid: false };
  }

  const lower = raw.toLowerCase();
  return { raw, lower, valid: isValidEmail(raw) };
}

export function isValidEmail(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return false;
  if (/\s/.test(trimmed)) return false;

  const atCount = (trimmed.match(/@/g) ?? []).length;
  if (atCount !== 1) return false;

  const [local, domain] = trimmed.split("@");
  if (!local || local.length === 0) return false;
  if (!domain || domain.length === 0) return false;

  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;
  if (local.includes("..")) return false;
  if (!domain.includes(".")) return false;

  const domainParts = domain.split(".");
  const tld = domainParts[domainParts.length - 1];
  if (!tld || tld.length < 2) return false;
  if (domainParts.some((part) => part.length === 0)) return false;

  // Pragmatic local-part / domain character check: no disallowed whitespace or
  // control characters; letters, digits, and common symbols are fine.
  const localOk = /^[^\s@]+$/.test(local);
  const domainOk = /^[A-Za-z0-9.-]+$/.test(domain);

  return localOk && domainOk;
}

export function emailLower(input: string): string {
  return input.trim().toLowerCase();
}
