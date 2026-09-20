/**
 * Renders an invoice or quote to PDF bytes with pdf-lib.
 *
 * Voice (docs/DESIGN.md section 11): direct, specific, warm. Sentence case
 * labels except the small uppercase section labels. No hype, no exclamation
 * marks, no emoji anywhere, including in these comments.
 *
 * Shape (docs/DESIGN.md section 6): hard edges only. No gradient, no
 * blurred shadow, no rounded corner. The only filled colour on the page is
 * one block in the totals -- "Total" on an invoice nobody has paid against
 * (and on every quote), or "Balance due" once a payment exists (see
 * planTotalsRows below): DESIGN.md allows exactly one primary block per
 * view, so the moment there is a figure the customer has to act on, that is
 * the one that gets it.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import type { RGB } from "pdf-lib";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { resolveBillToBlock } from "@/features/invoices/lib/billTo";
import {
  hasMixedTaxability,
  summarizeTaxLines,
  taxRowLabel,
  type TaxLineSummary,
} from "@/features/invoices/lib/taxLabel";
import {
  COLOR_HAIRLINE,
  COLOR_MUTED,
  COLOR_NEAR_BLACK,
  COLOR_NEUTRAL_DARK,
  COLOR_NEUTRAL_LIGHT,
  COLOR_ON_PRIMARY,
  COLOR_PRIMARY,
  CONTENT_BOTTOM_LIMIT,
  CONTENT_WIDTH,
  FOOTER_BASELINE_Y,
  HAIRLINE_THICKNESS,
  LOGO_SIZE,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  ROW_DESCRIPTION_EXTRA,
  ROW_HEIGHT,
  TABLE_HEADER_HEIGHT,
} from "./brand";
import { loadAssets } from "./assets";
import type { DocumentAssets } from "./assets";

export type RenderLine = {
  name: string;
  description: string | null;
  qty: number;
  unitCents: number;
  taxable: boolean;
  kind: string;
  interval: string | null;
};

/** One payment listed under the totals block, on an invoice that has any. */
export type RenderPaymentLine = {
  paidOn: string;
  methodLabel: string;
  reference: string | null;
  amountCents: number;
};

/**
 * The payments block for an invoice PDF (LR-PX-A W3). Absent (or null) on a
 * quote, and on an invoice with no payments -- the totals block then draws
 * exactly as it always has, byte-for-byte, which is the point: an invoice
 * nobody has paid against yet must not change shape just because the feature
 * exists.
 */
export type RenderPaymentsBlock = {
  lines: RenderPaymentLine[];
  paidToDateCents: number;
  balanceDueCents: number;
};

export type RenderInput = {
  kind: "quote" | "invoice";
  number: string;
  issuedOn: string | null;
  dueOn: string | null;
  validUntil: string | null;
  business: { name: string; address: string; phone: string; email: string; taxId: string };
  customer: { name: string; company: string; email: string; phone: string; address: string };
  lines: RenderLine[];
  subtotalCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  notes: string | null;
  paymentInstructions: string | null;
  payments?: RenderPaymentsBlock | null;
};

// ---------------------------------------------------------------------------
// Text measurement helpers.
// ---------------------------------------------------------------------------

/**
 * Greedily wraps `text` to fit within `maxWidth` at the given font/size,
 * splitting on whitespace. A single word wider than `maxWidth` on its own is
 * broken at the character level so it never overflows the column.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const ch of word) {
        const candidate = chunk + ch;
        if (chunk !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = candidate;
        }
      }
      current = chunk;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/** wrapText, but respecting explicit newlines in the source text (addresses). */
export function splitAndWrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return text.split("\n").flatMap((part) => wrapText(part, font, size, maxWidth));
}

/** Truncates a single line to fit `maxWidth`, appending an ellipsis if it does not already fit. */
export function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const ellipsis = "…";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 0 && font.widthOfTextAtSize(result + ellipsis, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result.length > 0 ? `${result}${ellipsis}` : ellipsis;
}

/** Wraps text and caps it at `maxLines`, marking truncation with an ellipsis on the last line. */
export function wrapAndClip(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = wrapText(text, font, size, maxWidth);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const lastIndex = maxLines - 1;
  visible[lastIndex] = truncateToWidth(`${visible[lastIndex]}…`, font, size, maxWidth);
  return visible;
}

function formatQty(qty: number): string {
  if (Number.isInteger(qty)) return String(qty);
  return qty.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

/** "monthly"/"per month" style suffix printed after a recurring line's name. */
function intervalSuffix(line: RenderLine): string | null {
  const value = (line.interval ?? "").trim().toLowerCase();
  if (value === "") return null;
  if (value.includes("month")) return "per month";
  if (value.includes("year") || value.includes("annual")) return "per year";
  return `per ${value}`;
}

// ---------------------------------------------------------------------------
// Low-level drawing helpers.
// ---------------------------------------------------------------------------

export function drawRightAligned(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y, size, font, color });
}

/** Manual letter-spacing: pdf-lib has no tracking, so small uppercase labels are drawn glyph by glyph. */
export function trackedWidth(text: string, font: PDFFont, size: number, tracking: number): number {
  let total = 0;
  for (const ch of text) total += font.widthOfTextAtSize(ch, size) + tracking;
  return total > 0 ? total - tracking : 0;
}

export function drawTrackedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  tracking: number,
): void {
  let cursorX = x;
  for (const ch of text) {
    page.drawText(ch, { x: cursorX, y, size, font, color });
    cursorX += font.widthOfTextAtSize(ch, size) + tracking;
  }
}

export function drawRightAlignedTracked(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  tracking: number,
): void {
  const width = trackedWidth(text, font, size, tracking);
  drawTrackedText(page, text, rightX - width, y, font, size, color, tracking);
}

/** A small uppercase tracked section label ("Bill to" -> "BILL TO"), sentence-case source, drawn tracked+uppercase. */
export function drawSectionLabel(page: PDFPage, text: string, x: number, y: number, font: PDFFont): void {
  drawTrackedText(page, text.toUpperCase(), x, y, font, 7.5, COLOR_MUTED, 1.1);
}

export function drawHairline(page: PDFPage, y: number, x = PAGE_MARGIN, width = CONTENT_WIDTH): number {
  page.drawRectangle({
    x,
    y: y - HAIRLINE_THICKNESS,
    width,
    height: HAIRLINE_THICKNESS,
    color: COLOR_HAIRLINE,
  });
  return y - HAIRLINE_THICKNESS - 14;
}

// ---------------------------------------------------------------------------
// Fonts. Custom TTFs are embedded through @pdf-lib/fontkit when it is
// installed; otherwise this falls back cleanly to pdf-lib's built-in
// Helvetica / Helvetica-Bold. The two paths share the same FontSet shape so
// nothing downstream needs to know which one is active.
// ---------------------------------------------------------------------------

export type FontSet = {
  heading: PDFFont;
  headingBold: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
};

async function tryEnableFontkit(doc: PDFDocument): Promise<boolean> {
  try {
    // Built from string parts, and with the Vite-ignore hint, so bundlers
    // and ts-node never try to statically resolve a package that may not be
    // installed. @pdf-lib/fontkit is what lets pdf-lib embed arbitrary TTF
    // bytes; without it, embedFont only accepts pdf-lib's own StandardFonts.
    const moduleId = ["@pdf-lib", "fontkit"].join("/");
    const mod: unknown = await import(/* @vite-ignore */ moduleId);
    const fontkit = (mod as { default?: unknown })?.default ?? mod;
    doc.registerFontkit(fontkit as Parameters<typeof doc.registerFontkit>[0]);
    return true;
  } catch {
    return false;
  }
}

async function embedWithFallback(
  doc: PDFDocument,
  bytes: Uint8Array | null,
  fontkitReady: boolean,
  standard: StandardFonts,
): Promise<PDFFont> {
  if (fontkitReady && bytes) {
    try {
      return await doc.embedFont(bytes, { subset: true });
    } catch {
      // Corrupt or unsupported font bytes: fall through to the standard font.
    }
  }
  return doc.embedFont(standard);
}

export async function loadFontSet(doc: PDFDocument, assets: DocumentAssets): Promise<FontSet> {
  const fontkitReady = await tryEnableFontkit(doc);
  const [heading, headingBold, body, bodyBold] = await Promise.all([
    embedWithFallback(doc, assets.fonts.heading, fontkitReady, StandardFonts.HelveticaBold),
    embedWithFallback(doc, assets.fonts.headingBold, fontkitReady, StandardFonts.HelveticaBold),
    embedWithFallback(doc, assets.fonts.body, fontkitReady, StandardFonts.Helvetica),
    embedWithFallback(doc, assets.fonts.bodyBold, fontkitReady, StandardFonts.HelveticaBold),
  ]);
  return { heading, headingBold, body, bodyBold };
}

// ---------------------------------------------------------------------------
// Column layout for the line-item table.
// ---------------------------------------------------------------------------

type ColumnLayout = {
  descriptionColX: number;
  descriptionColWidth: number;
  qtyColRight: number;
  unitColRight: number;
  amountColRight: number;
};

function buildColumnLayout(contentRight: number): ColumnLayout {
  const qtyColWidth = 46;
  const unitColWidth = 74;
  const amountColWidth = 80;
  const colGap = 10;

  const amountColRight = contentRight;
  const unitColRight = amountColRight - amountColWidth - colGap;
  const qtyColRight = unitColRight - unitColWidth - colGap;
  const descriptionColX = PAGE_MARGIN;
  const descriptionColWidth = qtyColRight - qtyColWidth - descriptionColX - colGap;

  return { descriptionColX, descriptionColWidth, qtyColRight, unitColRight, amountColRight };
}

// ---------------------------------------------------------------------------
// Page sections.
// ---------------------------------------------------------------------------

function drawHeader(
  page: PDFPage,
  fonts: FontSet,
  logoImage: PDFImage | null,
  input: RenderInput,
  title: string,
  startY: number,
): number {
  const marginX = PAGE_MARGIN;
  const rightEdge = PAGE_WIDTH - PAGE_MARGIN;

  if (logoImage) {
    page.drawImage(logoImage, {
      x: marginX,
      y: startY - LOGO_SIZE,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
  }

  const nameX = logoImage ? marginX + LOGO_SIZE + 12 : marginX;
  const nameSize = 22;
  const nameMaxWidth = rightEdge - 180 - nameX;
  const nameLine = wrapAndClip(input.business.name, fonts.headingBold, nameSize, Math.max(nameMaxWidth, 120), 1)[0] ?? "";
  page.drawText(nameLine, {
    x: nameX,
    y: startY - nameSize + 5,
    size: nameSize,
    font: fonts.headingBold,
    color: COLOR_NEAR_BLACK,
  });

  // Title block, top right: "Invoice"/"Quote", the number, then date pairs.
  let titleY = startY;
  const titleSize = 18;
  const titleWidth = fonts.heading.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: rightEdge - titleWidth,
    y: titleY - titleSize + 5,
    size: titleSize,
    font: fonts.heading,
    color: COLOR_NEAR_BLACK,
  });
  titleY -= titleSize + 8;

  const numberSize = 10;
  drawRightAligned(page, input.number, rightEdge, titleY, fonts.bodyBold, numberSize, COLOR_NEUTRAL_DARK);
  titleY -= numberSize + 10;

  const datePairs: Array<[string, string | null]> =
    input.kind === "invoice"
      ? [
          ["Issued", input.issuedOn],
          ["Due", input.dueOn],
        ]
      : [
          ["Issued", input.issuedOn],
          ["Valid until", input.validUntil],
        ];

  const dateSize = 9;
  for (const [label, value] of datePairs) {
    if (!value) continue;
    const text = `${label}: ${formatDateDisplay(value)}`;
    drawRightAligned(page, text, rightEdge, titleY, fonts.body, dateSize, COLOR_MUTED);
    titleY -= dateSize + 6;
  }

  // Business contact block, left, under the name.
  //
  // It has to clear whichever of the two things above it reaches lower: the
  // name's own baseline, or the bottom of the mark sitting beside it. Keying
  // off the name alone put the first line of the address straight through the
  // bottom edge of the logo, which the first rendered sample showed plainly.
  let leftY = Math.min(startY - nameSize - 12, startY - LOGO_SIZE - 12);
  const infoSize = 9;
  const infoWidth = CONTENT_WIDTH * 0.55;
  const contactLine = [input.business.phone, input.business.email, input.business.taxId]
    .filter((v) => v && v.trim() !== "")
    .join("   ·   ");
  const infoParagraphs = [input.business.address, contactLine].filter((v) => v && v.trim() !== "");

  for (const paragraph of infoParagraphs) {
    for (const line of splitAndWrap(paragraph, fonts.body, infoSize, infoWidth)) {
      page.drawText(line, { x: marginX, y: leftY, size: infoSize, font: fonts.body, color: COLOR_NEUTRAL_DARK });
      leftY -= infoSize + 5;
    }
  }

  return Math.min(leftY, titleY, startY - LOGO_SIZE - 10) - 10;
}

function drawCustomerBlock(
  page: PDFPage,
  fonts: FontSet,
  input: RenderInput,
  label: string,
  startY: number,
): number {
  let y = startY;
  drawSectionLabel(page, label, PAGE_MARGIN, y, fonts.body);
  y -= 18;

  const billTo = resolveBillToBlock({
    contactName: input.customer.name,
    companyName: input.customer.company,
    email: input.customer.email,
    phone: input.customer.phone,
    address: input.customer.address,
  });

  const nameSize = 11;
  for (const line of wrapAndClip(billTo.title, fonts.bodyBold, nameSize, CONTENT_WIDTH, 2)) {
    page.drawText(line, { x: PAGE_MARGIN, y, size: nameSize, font: fonts.bodyBold, color: COLOR_NEAR_BLACK });
    y -= nameSize + 5;
  }

  // Each part keeps the wrapping it has always had: the company clips to one
  // line so a long legal name cannot push the page down, an address wraps, and
  // an email or a phone number is one line whole. What to show at all was
  // decided in billTo.ts, which is also what the screen asks.
  const detailSize = 9.5;
  const detailLines: string[] = [];
  if (billTo.company) {
    detailLines.push(...wrapAndClip(billTo.company, fonts.body, detailSize, CONTENT_WIDTH, 1));
  }
  for (const addressLine of billTo.addressLines) {
    detailLines.push(...wrapText(addressLine, fonts.body, detailSize, CONTENT_WIDTH));
  }
  if (billTo.email) detailLines.push(billTo.email);
  if (billTo.phone) detailLines.push(billTo.phone);

  for (const line of detailLines) {
    page.drawText(line, { x: PAGE_MARGIN, y, size: detailSize, font: fonts.body, color: COLOR_NEUTRAL_DARK });
    y -= detailSize + 5;
  }

  return y - 8;
}

function drawTableHeader(page: PDFPage, fonts: FontSet, startY: number, cols: ColumnLayout): number {
  const headerTop = startY;
  const headerHeight = TABLE_HEADER_HEIGHT;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: headerTop - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    color: COLOR_NEUTRAL_LIGHT,
  });

  const labelSize = 7.5;
  const baseline = headerTop - headerHeight / 2 - labelSize / 2 + 2;
  drawTrackedText(page, "DESCRIPTION", cols.descriptionColX + 6, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "QTY", cols.qtyColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "UNIT", cols.unitColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "AMOUNT", cols.amountColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);

  const bottom = headerTop - headerHeight;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: bottom - HAIRLINE_THICKNESS,
    width: CONTENT_WIDTH,
    height: HAIRLINE_THICKNESS,
    color: COLOR_HAIRLINE,
  });

  return bottom - HAIRLINE_THICKNESS - 8;
}

/**
 * The vertical space `drawLineRow` will consume for `line`, without drawing
 * anything. This is the single source of truth for a row's height: the page
 * planner below calls it to decide where a page breaks, and `drawLineRow`
 * calls it too, so the two can never drift apart.
 *
 * A description reserves a fixed extra band (ROW_DESCRIPTION_EXTRA) sized
 * for wrapAndClip's two-line cap, regardless of whether the actual text
 * wraps to one line or two -- `drawLineRow` positions its description text
 * within that same fixed band, so the row's total height never varies with
 * the wrap count itself, only with whether a description is present.
 */
function measureRowHeight(line: RenderLine): number {
  const hasDescription = Boolean(line.description && line.description.trim() !== "");
  return hasDescription ? ROW_HEIGHT + ROW_DESCRIPTION_EXTRA : ROW_HEIGHT;
}

function drawLineRow(
  page: PDFPage,
  fonts: FontSet,
  line: RenderLine,
  currency: string,
  startY: number,
  cols: ColumnLayout,
  showTaxTag: boolean,
): number {
  const nameSize = 9.5;
  const baseline = startY - nameSize;

  const nameText = truncateToWidth(line.name, fonts.bodyBold, nameSize, cols.descriptionColWidth);
  page.drawText(nameText, {
    x: cols.descriptionColX,
    y: baseline,
    size: nameSize,
    font: fonts.bodyBold,
    color: COLOR_NEAR_BLACK,
  });

  // "per month" and "taxable" are both muted captions trailing the name -
  // only the second appears, and only when the document mixes taxable and
  // non-taxable lines, so a line reads as taxed without a reader having to
  // find it in a column further right.
  const captionParts: string[] = [];
  const suffix = intervalSuffix(line);
  if (suffix) captionParts.push(suffix);
  if (showTaxTag) captionParts.push("taxable");
  if (captionParts.length > 0) {
    const nameWidth = fonts.bodyBold.widthOfTextAtSize(nameText, nameSize);
    page.drawText(` ${captionParts.join(" · ")}`, {
      x: cols.descriptionColX + nameWidth + 4,
      y: baseline,
      size: nameSize - 1.5,
      font: fonts.body,
      color: COLOR_MUTED,
    });
  }

  drawRightAligned(page, formatQty(line.qty), cols.qtyColRight, baseline, fonts.body, nameSize, COLOR_NEUTRAL_DARK);
  drawRightAligned(
    page,
    formatMoney(line.unitCents, currency),
    cols.unitColRight,
    baseline,
    fonts.body,
    nameSize,
    COLOR_NEUTRAL_DARK,
  );

  const amountCents = Math.round(line.qty * line.unitCents);
  drawRightAligned(
    page,
    formatMoney(amountCents, currency),
    cols.amountColRight,
    baseline,
    fonts.bodyBold,
    nameSize,
    COLOR_NEAR_BLACK,
  );

  if (line.description && line.description.trim() !== "") {
    const descSize = 8;
    const descLines = wrapAndClip(line.description, fonts.body, descSize, cols.descriptionColWidth, 2);
    let descY = baseline - (nameSize - 1);
    for (const descLine of descLines) {
      descY -= descSize + 2;
      page.drawText(descLine, {
        x: cols.descriptionColX,
        y: descY,
        size: descSize,
        font: fonts.body,
        color: COLOR_MUTED,
      });
    }
  }

  return startY - measureRowHeight(line);
}

/**
 * The rows the totals block draws, computed once as pure data so a test can
 * assert on it directly -- pdf-lib cannot read text back out of a saved PDF
 * (see the note at the bottom of pdfLayout.test.ts), so this is what proves
 * "an invoice with two payments carries a 'Balance due' row for the right
 * figure, and an invoice with none carries neither string".
 *
 * With no payments this is exactly the shape the totals block has always
 * drawn: Subtotal (and tax, when it applies), then the filled block reading
 * "Total". With payments, Total steps down to an ordinary row, "Paid to
 * date" joins it, and the filled block -- the one confident colour the page
 * spends -- moves to "Balance due", the figure the customer actually acts
 * on. The total still prints, one line above it, exactly where it always
 * was; DESIGN.md's "one primary block per view" is why it stops being
 * filled once something else needs to be.
 */
export function planTotalsRows(
  input: RenderInput,
  taxSummary: TaxLineSummary,
): { plainRows: Array<[string, number]>; filledLabel: string; filledCents: number } {
  const rate = input.taxRateBp / 100;
  const rows: Array<[string, number]> = [["Subtotal", input.subtotalCents]];
  const taxRow = taxRowLabel(taxSummary, input.taxCents, `${formatPercent(rate)}%`, (cents) =>
    formatMoney(cents, input.currency),
  );
  if (taxRow.show) rows.push([taxRow.label, input.taxCents]);

  const payments = input.payments;
  if (!payments) {
    return { plainRows: rows, filledLabel: "Total", filledCents: input.totalCents };
  }

  rows.push(["Total", input.totalCents]);
  rows.push(["Paid to date", payments.paidToDateCents]);
  return { plainRows: rows, filledLabel: "Balance due", filledCents: payments.balanceDueCents };
}

/** The two strings one payment line draws under the totals block. */
export function paymentsListLineText(
  line: RenderPaymentLine,
  currency: string,
): { left: string; right: string } {
  const refPart = line.reference && line.reference.trim() !== "" ? ` · ${line.reference}` : "";
  return {
    left: `${formatDateDisplay(line.paidOn)} · ${line.methodLabel}${refPart}`,
    right: formatMoney(line.amountCents, currency),
  };
}

function drawTotals(
  page: PDFPage,
  fonts: FontSet,
  input: RenderInput,
  startY: number,
  contentRight: number,
  taxSummary: TaxLineSummary,
): number {
  const boxWidth = 220;
  const boxX = contentRight - boxWidth;
  const rowSize = 9.5;
  const rowGap = 8;

  let y = startY;

  const plan = planTotalsRows(input, taxSummary);
  for (const [label, cents] of plan.plainRows) {
    y -= rowSize;
    page.drawText(label, { x: boxX, y, size: rowSize, font: fonts.body, color: COLOR_NEUTRAL_DARK });
    drawRightAligned(page, formatMoney(cents, input.currency), contentRight, y, fonts.body, rowSize, COLOR_NEUTRAL_DARK);
    y -= rowGap;
  }

  // The filled block: the one confident colour on the page, flat, hard edges.
  // "Total" when there are no payments; "Balance due" once there are (see
  // planTotalsRows above).
  const totalHeight = 30;
  const totalTop = y;
  const totalBottom = totalTop - totalHeight;
  page.drawRectangle({ x: boxX, y: totalBottom, width: boxWidth, height: totalHeight, color: COLOR_PRIMARY });

  const totalSize = 12;
  const totalBaseline = totalBottom + (totalHeight - totalSize) / 2 + 2;
  page.drawText(plan.filledLabel, {
    x: boxX + 14,
    y: totalBaseline,
    size: totalSize,
    font: fonts.bodyBold,
    color: COLOR_ON_PRIMARY,
  });
  drawRightAligned(
    page,
    formatMoney(plan.filledCents, input.currency),
    contentRight - 14,
    totalBaseline,
    fonts.bodyBold,
    totalSize,
    COLOR_ON_PRIMARY,
  );

  return totalBottom - 24;
}

/**
 * The payment lines under the totals block -- only drawn once there is more
 * than one payment (F-LR-PX-A). A single payment is already fully told by
 * "Paid to date"; a list of one row would just repeat it.
 */
function drawPaymentsList(page: PDFPage, fonts: FontSet, input: RenderInput, startY: number): number {
  const payments = input.payments;
  if (!payments || payments.lines.length <= 1) return startY;

  let y = startY;
  drawSectionLabel(page, "Payments", PAGE_MARGIN, y, fonts.body);
  y -= 16;

  const size = 9;
  for (const line of payments.lines) {
    const { left, right } = paymentsListLineText(line, input.currency);
    page.drawText(left, { x: PAGE_MARGIN, y, size, font: fonts.body, color: COLOR_NEUTRAL_DARK });
    drawRightAligned(page, right, PAGE_WIDTH - PAGE_MARGIN, y, fonts.body, size, COLOR_NEUTRAL_DARK);
    y -= size + 4;
  }
  return y - 10;
}

function drawLabeledBlock(
  page: PDFPage,
  fonts: FontSet,
  label: string,
  body: string,
  x: number,
  startY: number,
): number {
  let y = startY;
  drawSectionLabel(page, label, x, y, fonts.body);
  y -= 16;
  const size = 9;
  for (const line of splitAndWrap(body, fonts.body, size, CONTENT_WIDTH)) {
    page.drawText(line, { x, y, size, font: fonts.body, color: COLOR_NEUTRAL_DARK });
    y -= size + 4;
  }
  return y - 10;
}

function drawNotesAndPayment(page: PDFPage, fonts: FontSet, input: RenderInput, startY: number): number {
  let y = startY;
  if (input.notes && input.notes.trim() !== "") {
    y = drawLabeledBlock(page, fonts, "Notes", input.notes, PAGE_MARGIN, y);
  }
  if (input.paymentInstructions && input.paymentInstructions.trim() !== "") {
    y = drawLabeledBlock(page, fonts, "Payment instructions", input.paymentInstructions, PAGE_MARGIN, y);
  }
  return y;
}

export function drawFooter(page: PDFPage, fonts: FontSet, documentNumber: string, pageNumber: number, pageCount: number): void {
  const size = 8;
  page.drawText(documentNumber, { x: PAGE_MARGIN, y: FOOTER_BASELINE_Y, size, font: fonts.body, color: COLOR_MUTED });
  drawRightAligned(
    page,
    `Page ${pageNumber} of ${pageCount}`,
    PAGE_WIDTH - PAGE_MARGIN,
    FOOTER_BASELINE_Y,
    fonts.body,
    size,
    COLOR_MUTED,
  );
}

// ---------------------------------------------------------------------------
// Page planning: measured, not counted (F-LB-21).
//
// A row's real drawn height depends on whether it has a description
// (measureRowHeight, above). Page one also spends a variable amount of
// space on the header, the bill-to block, and two hairlines -- driven
// entirely by the business/customer strings in this particular document, so
// there is no constant that predicts it. Rather than guess, this measures
// those blocks once by actually drawing them -- the same drawHeader,
// drawCustomerBlock, drawTableHeader, drawTotals, and drawNotesAndPayment
// the real pages call -- and reads back the resulting y, so the measured
// start can never drift from the drawn one.
//
// That drawing happens on a page appended to a throwaway PDFDocument (see
// prepareMeasurementContext), never the real output document. An earlier
// version measured on a scratch page appended to, then removed from, the
// real doc -- PDFDocument.removePage only detaches a page from the page
// tree, it does not drop the content stream already drawn into it, so that
// scratch page's ink still got serialized on save as an unreachable object.
// Measured cost: a plain single-page invoice went from 132,766 to 136,699
// bytes, +3%, entirely dead weight. A separate document that is simply never
// saved costs the output nothing.
// ---------------------------------------------------------------------------

/** Fonts and logo embedded in a throwaway PDFDocument, used only to measure -- never drawn into the real output or saved. */
export type MeasurementContext = {
  doc: PDFDocument;
  fonts: FontSet;
  logoImage: PDFImage | null;
};

export async function prepareMeasurementContext(resolvedAssets: DocumentAssets): Promise<MeasurementContext> {
  const doc = await PDFDocument.create();
  const fonts = await loadFontSet(doc, resolvedAssets);

  let logoImage: PDFImage | null = null;
  if (resolvedAssets.logoPng) {
    try {
      logoImage = await doc.embedPng(resolvedAssets.logoPng);
    } catch {
      logoImage = null;
    }
  }

  return { doc, fonts, logoImage };
}

/** Runs `fn` against a fresh page appended to the throwaway measurement document. That document is never saved, so the page (and anything drawn on it) never reaches the output. */
export function measureOnScratchPage<T>(measurement: MeasurementContext, fn: (page: PDFPage) => T): T {
  const page = measurement.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return fn(page);
}

type PageStartYs = {
  /** y at which the first table row begins on page one, after the header, bill-to block, and table header. */
  firstPage: number;
  /** y at which the first table row begins on any later page, after just the repeated table header. */
  continuation: number;
};

function measurePageStartYs(
  measurement: MeasurementContext,
  input: RenderInput,
  title: string,
  billToLabel: string,
  cols: ColumnLayout,
): PageStartYs {
  const { fonts, logoImage } = measurement;

  const firstPage = measureOnScratchPage(measurement, (page) => {
    let y = PAGE_HEIGHT - PAGE_MARGIN;
    y = drawHeader(page, fonts, logoImage, input, title, y);
    y = drawHairline(page, y);
    y = drawCustomerBlock(page, fonts, input, billToLabel, y);
    y = drawHairline(page, y);
    return drawTableHeader(page, fonts, y, cols);
  });

  const continuation = measureOnScratchPage(measurement, (page) =>
    drawTableHeader(page, fonts, PAGE_HEIGHT - PAGE_MARGIN, cols),
  );

  return { firstPage, continuation };
}

/** The vertical space `drawTotals` + `drawNotesAndPayment` will consume, including the 14pt gap the render loop puts before them. */
function measureFooterBlockHeight(
  measurement: MeasurementContext,
  input: RenderInput,
  contentRight: number,
  taxSummary: TaxLineSummary,
): number {
  const { fonts } = measurement;
  const reference = PAGE_HEIGHT;
  return measureOnScratchPage(measurement, (page) => {
    let y = reference - 14;
    y = drawTotals(page, fonts, input, y, contentRight, taxSummary);
    y = drawPaymentsList(page, fonts, input, y);
    y = drawNotesAndPayment(page, fonts, input, y);
    return reference - y;
  });
}

/**
 * Assigns lines to pages by measured row height instead of a fixed count per
 * page, breaking to a new page whenever the next row would cross
 * CONTENT_BOTTOM_LIMIT (which already leaves room for the footer). A page
 * that has not yet taken a row always accepts the next one regardless of
 * fit -- so a single row taller than an entire empty page still gets drawn,
 * on its own page, rather than looping forever trying to place it.
 *
 * If the page holding the last rows would leave no room above the footer
 * for the totals block and the notes/payment block, one further page (with
 * no rows of its own) is appended for them. The normal per-page render loop
 * still draws that page's table header first, exactly as it does for any
 * other continuation page.
 */
function planPages(input: RenderInput, startYs: PageStartYs, footerBlockHeight: number): RenderLine[][] {
  const pages: RenderLine[][] = [];
  let current: RenderLine[] = [];
  let cursorY = startYs.firstPage;

  for (const line of input.lines) {
    const height = measureRowHeight(line);
    if (current.length > 0 && cursorY - height < CONTENT_BOTTOM_LIMIT) {
      pages.push(current);
      current = [];
      cursorY = startYs.continuation;
    }
    current.push(line);
    cursorY -= height;
  }
  pages.push(current);

  if (cursorY - footerBlockHeight < CONTENT_BOTTOM_LIMIT) {
    pages.push([]);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Shared setup between renderDocument() and the page-layout diagnostic below.
// ---------------------------------------------------------------------------

type RenderContext = {
  doc: PDFDocument;
  title: string;
  fonts: FontSet;
  logoImage: PDFImage | null;
  billToLabel: string;
  contentRight: number;
  cols: ColumnLayout;
  taxSummary: TaxLineSummary;
  mixedTax: boolean;
  /** Fonts/logo embedded in a separate, never-saved document, for layout measurement only. */
  measurement: MeasurementContext;
};

async function prepareRenderContext(input: RenderInput, assets?: DocumentAssets): Promise<RenderContext> {
  const resolvedAssets = assets ?? (await loadAssets());
  const doc = await PDFDocument.create();

  const title = input.kind === "invoice" ? "Invoice" : "Quote";
  const fonts = await loadFontSet(doc, resolvedAssets);

  let logoImage: PDFImage | null = null;
  if (resolvedAssets.logoPng) {
    try {
      logoImage = await doc.embedPng(resolvedAssets.logoPng);
    } catch {
      logoImage = null;
    }
  }

  const billToLabel = input.kind === "invoice" ? "Bill to" : "Prepared for";
  const contentRight = PAGE_WIDTH - PAGE_MARGIN;
  const cols = buildColumnLayout(contentRight);

  const taxSummary = summarizeTaxLines(
    input.lines.map((line) => ({
      taxable: line.taxable,
      amountCents: Math.round(line.qty * line.unitCents),
    })),
  );
  const mixedTax = hasMixedTaxability(taxSummary);

  const measurement = await prepareMeasurementContext(resolvedAssets);

  return { doc, title, fonts, logoImage, billToLabel, contentRight, cols, taxSummary, mixedTax, measurement };
}

// ---------------------------------------------------------------------------
// Test diagnostic: the same page plan renderDocument() draws, without
// drawing any real page.
//
// pdf-lib cannot read drawn coordinates back out of a saved PDF (see the
// note at the bottom of pdfLayout.test.ts), so a test cannot ask a rendered
// document "was anything drawn below the footer". This exposes the actual
// measured plan instead -- the same startYs, the same footerBlockHeight, and
// the same measureRowHeight this file uses to draw -- so a test can assert
// directly that no page's content bottom ever crosses CONTENT_BOTTOM_LIMIT,
// rather than checking the result by eye.
// ---------------------------------------------------------------------------

export type PageLayoutPlan = {
  pageCount: number;
  /** Number of line rows placed on each page, in order. A trailing 0 means that page holds only totals/notes/payment. */
  rowsPerPage: number[];
  /** The y-coordinate after the last thing drawn on each page (the last row, or on the last page, the totals + notes/payment block). Must stay >= CONTENT_BOTTOM_LIMIT. */
  contentBottomYPerPage: number[];
};

export async function planPageLayout(input: RenderInput, assets?: DocumentAssets): Promise<PageLayoutPlan> {
  const { title, billToLabel, contentRight, cols, taxSummary, measurement } = await prepareRenderContext(
    input,
    assets,
  );

  const startYs = measurePageStartYs(measurement, input, title, billToLabel, cols);
  const footerBlockHeight = measureFooterBlockHeight(measurement, input, contentRight, taxSummary);
  const pages = planPages(input, startYs, footerBlockHeight);

  const contentBottomYPerPage = pages.map((rows, index) => {
    const startY = index === 0 ? startYs.firstPage : startYs.continuation;
    const afterRows = rows.reduce((y, line) => y - measureRowHeight(line), startY);
    const isLastPage = index === pages.length - 1;
    return isLastPage ? afterRows - footerBlockHeight : afterRows;
  });

  return {
    pageCount: pages.length,
    rowsPerPage: pages.map((rows) => rows.length),
    contentBottomYPerPage,
  };
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export async function renderDocument(input: RenderInput, assets?: DocumentAssets): Promise<Uint8Array> {
  const { doc, title, fonts, logoImage, billToLabel, contentRight, cols, taxSummary, mixedTax, measurement } =
    await prepareRenderContext(input, assets);

  doc.setTitle(`${title} ${input.number}`);
  doc.setProducer("Helix CRM");

  const startYs = measurePageStartYs(measurement, input, title, billToLabel, cols);
  const footerBlockHeight = measureFooterBlockHeight(measurement, input, contentRight, taxSummary);
  const pages = planPages(input, startYs, footerBlockHeight);
  const pageCount = pages.length;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === pageCount - 1;

    let cursorY = PAGE_HEIGHT - PAGE_MARGIN;

    if (isFirstPage) {
      cursorY = drawHeader(page, fonts, logoImage, input, title, cursorY);
      cursorY = drawHairline(page, cursorY);
      cursorY = drawCustomerBlock(page, fonts, input, billToLabel, cursorY);
      cursorY = drawHairline(page, cursorY);
    }

    cursorY = drawTableHeader(page, fonts, cursorY, cols);

    for (const line of pages[pageIndex]) {
      cursorY = drawLineRow(page, fonts, line, input.currency, cursorY, cols, mixedTax && line.taxable);
    }

    if (isLastPage) {
      cursorY -= 14;
      cursorY = drawTotals(page, fonts, input, cursorY, contentRight, taxSummary);
      cursorY = drawPaymentsList(page, fonts, input, cursorY);
      cursorY = drawNotesAndPayment(page, fonts, input, cursorY);
    }

    drawFooter(page, fonts, input.number, pageIndex + 1, pageCount);
  }

  return doc.save();
}
