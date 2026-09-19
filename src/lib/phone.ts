// Pure phone normalisation helpers.
//
// Numbers are never rejected: an unparseable or invalid phone number keeps its
// raw text and gets `e164: null`. Dedupe and canonical storage happen on the
// `e164` field when it is present; display falls back to `raw` otherwise.

import {
  parsePhoneNumberFromString,
  isValidPhoneNumber as libIsValidPhoneNumber,
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js";

export type NormalizedPhone = { raw: string; e164: string | null };

// Default region for parsing when the caller does not specify one. In the app
// this comes from the workspace locale setting.
export const DEFAULT_REGION = "US";

/** Safely narrow an arbitrary string to a libphonenumber-js CountryCode. */
function toCountryCode(region: string | undefined): CountryCode | undefined {
  if (!region) return undefined;
  const upper = region.toUpperCase();
  return isSupportedCountry(upper) ? (upper as CountryCode) : undefined;
}

export function normalizePhone(input: string, region?: string): NormalizedPhone {
  const raw = input.trim();
  if (raw === "") {
    return { raw: "", e164: null };
  }

  const countryCode = toCountryCode(region) ?? toCountryCode(DEFAULT_REGION);

  try {
    const parsed = parsePhoneNumberFromString(raw, countryCode);
    if (parsed && parsed.isValid()) {
      return { raw, e164: parsed.number };
    }
  } catch {
    // Fall through: treat as unparseable.
  }

  return { raw, e164: null };
}

export function formatPhone(value: string | null | undefined, region?: string): string {
  if (value == null) return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";

  const countryCode = toCountryCode(region) ?? toCountryCode(DEFAULT_REGION);

  try {
    const parsed = parsePhoneNumberFromString(trimmed, countryCode);
    if (!parsed) return trimmed;

    if (countryCode && parsed.country === countryCode) {
      return parsed.formatNational();
    }
    return parsed.formatInternational();
  } catch {
    return trimmed;
  }
}

export function isValidPhone(input: string, region?: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return false;

  const countryCode = toCountryCode(region) ?? toCountryCode(DEFAULT_REGION);

  try {
    return libIsValidPhoneNumber(trimmed, countryCode);
  } catch {
    return false;
  }
}

export function phoneDigits(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";

  const leadingPlus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^0-9]/g, "");
  return leadingPlus + digits;
}
