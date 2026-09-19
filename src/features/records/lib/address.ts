/**
 * Addresses are stored as a JSON string in `address_json` so the schema does
 * not grow a column per line. Everything here is pure: parse, stringify, the
 * display lines, and the maps URL a one-tap action opens.
 */

export type Address = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
};

export const EMPTY_ADDRESS: Address = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal: "",
  country: "",
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Never throws: a hand-edited or legacy value degrades to line1. */
export function parseAddress(json: string | null | undefined): Address {
  if (!json) return { ...EMPTY_ADDRESS };
  const text = json.trim();
  if (text.length === 0) return { ...EMPTY_ADDRESS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY_ADDRESS, line1: text };
  }

  if (typeof parsed === "string") return { ...EMPTY_ADDRESS, line1: parsed.trim() };
  if (parsed === null || typeof parsed !== "object") return { ...EMPTY_ADDRESS };

  const raw = parsed as Record<string, unknown>;
  return {
    line1: str(raw.line1 ?? raw.street ?? raw.address1),
    line2: str(raw.line2 ?? raw.address2 ?? raw.unit),
    city: str(raw.city ?? raw.town),
    region: str(raw.region ?? raw.state ?? raw.province),
    postal: str(raw.postal ?? raw.zip ?? raw.postcode),
    country: str(raw.country),
  };
}

export function isEmptyAddress(address: Address): boolean {
  return Object.values(address).every((v) => v.trim().length === 0);
}

/** An all-blank address stores NULL rather than an empty object. */
export function stringifyAddress(address: Address): string | null {
  if (isEmptyAddress(address)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(address)) {
    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) out[key] = trimmedValue;
  }
  return JSON.stringify(out);
}

/** Street lines first, then "City, Region Postal", then the country. */
export function formatAddressLines(address: Address): string[] {
  const lines: string[] = [];
  if (address.line1) lines.push(address.line1);
  if (address.line2) lines.push(address.line2);

  const cityLine = [address.city, [address.region, address.postal].filter(Boolean).join(" ")]
    .filter((part) => part.trim().length > 0)
    .join(", ");
  if (cityLine.length > 0) lines.push(cityLine);

  if (address.country) lines.push(address.country);
  return lines;
}

export function formatAddressOneLine(address: Address): string {
  return formatAddressLines(address).join(", ");
}

/**
 * Apple Maps on macOS, which Windows resolves through its own handler; both
 * accept a plain query string. Returns null when there is nothing to look up.
 */
export function mapsUrl(address: Address): string | null {
  const query = formatAddressOneLine(address);
  if (query.length === 0) return null;
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}
