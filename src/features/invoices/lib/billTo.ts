/**
 * Who the bill-to block on a PDF names, and what else it prints under them.
 *
 * A document's contact is often missing a name (a company-only lead, an
 * import that only captured an email), and the PDF used to draw
 * `customer.name` as the bold top line no matter what -- an empty string
 * still gets a font, a size and a line of vertical space, so the block
 * opened with a blank line and the company sat underneath it as if it were
 * a detail rather than who the invoice is actually for. The fix has to live
 * in one place: the renderer draws whatever this resolver decides, and the
 * screen asks it for just the title, so the PDF and the UI can never name
 * the customer two different ways.
 */

export type BillToParty = {
  /** The person's full name as already joined, may be empty or whitespace. */
  contactName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Newline-separated address lines, as pdfFile already produces. */
  address?: string | null;
};

export type BillTo = {
  /** Never empty. The one bold line at the top of the block. */
  title: string;
  /** The lines under the title, in order, already trimmed and non-empty. */
  details: string[];
};

const NO_CUSTOMER = "No customer yet";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

type TitleSource = "contactName" | "companyName" | "email" | "none";

/** Which field supplied the title, so a detail line never repeats it -- a
 * plain string comparison would wrongly drop the company line on the rare
 * document where the contact's name and the company's name happen to match. */
function titleSource(party: BillToParty): TitleSource {
  if (clean(party.contactName) !== "") return "contactName";
  if (clean(party.companyName) !== "") return "companyName";
  if (clean(party.email) !== "") return "email";
  return "none";
}

/** Just the title, for a screen that has one line to spend. Never empty. */
export function billToTitle(party: BillToParty): string {
  switch (titleSource(party)) {
    case "contactName":
      return clean(party.contactName);
    case "companyName":
      return clean(party.companyName);
    case "email":
      return clean(party.email);
    default:
      return NO_CUSTOMER;
  }
}

/**
 * The block with its parts still separate.
 *
 * The PDF needs this rather than the flat list: a company name clips to one
 * line so a long legal name cannot push the rest of the page down, an address
 * line wraps, and an email is drawn whole. Deciding what to show happens once,
 * here, so the renderer never has to work out which entry in a flat array was
 * the company.
 */
export type BillToBlock = {
  title: string;
  /** Null when the company IS the title, or when there is no company. */
  company: string | null;
  addressLines: string[];
  /** Null when the email IS the title, or when there is none. */
  email: string | null;
  phone: string | null;
};

export function resolveBillToBlock(party: BillToParty): BillToBlock {
  const source = titleSource(party);
  const companyName = clean(party.companyName);
  const email = clean(party.email);
  const phone = clean(party.phone);

  return {
    title: billToTitle(party),
    company: companyName !== "" && source !== "companyName" ? companyName : null,
    addressLines: clean(party.address)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    email: email !== "" && source !== "email" ? email : null,
    phone: phone !== "" ? phone : null,
  };
}

/** The whole block flattened: title plus details, with nothing repeated. */
export function resolveBillTo(party: BillToParty): BillTo {
  const block = resolveBillToBlock(party);
  return {
    title: block.title,
    details: [
      ...(block.company ? [block.company] : []),
      ...block.addressLines,
      ...(block.email ? [block.email] : []),
      ...(block.phone ? [block.phone] : []),
    ],
  };
}
