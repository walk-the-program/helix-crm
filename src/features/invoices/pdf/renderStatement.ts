/**
 * Renders a customer statement to PDF bytes with pdf-lib.
 *
 * "What this customer still owes me" for one period: the opening balance,
 * every invoice and every payment in date order with a running balance, and
 * the closing balance. It shares brand.ts, assets.ts, the font-loading and
 * low-level drawing primitives, and the measured-page-break machinery with
 * the invoice/quote renderer (renderDocument.ts) -- a statement has to look
 * like it came from the same business on the same day, and the surest way to
 * guarantee that is to draw it with the same code rather than a second
 * hand-tuned copy of it.
 *
 * Voice (docs/DESIGN.md section 11): direct, specific, warm. No "thanks for
 * your business" filler -- the closing line states the position in one
 * sentence and stops.
 *
 * Shape (docs/DESIGN.md section 6): hard edges only. No gradient, no
 * blurred shadow, no rounded corner. The only filled colour on the page is
 * the closing-balance row, the same treatment the invoice PDF gives its own
 * one confident block.
 */
import { PDFDocument } from "pdf-lib";
import type { PDFImage, PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { resolveBillToBlock } from "@/features/invoices/lib/billTo";
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
  ROW_HEIGHT,
  TABLE_HEADER_HEIGHT,
} from "./brand";
import { loadAssets } from "./assets";
import type { DocumentAssets } from "./assets";
import {
  drawHairline,
  drawRightAligned,
  drawRightAlignedTracked,
  drawSectionLabel,
  drawTrackedText,
  loadFontSet,
  measureOnScratchPage,
  prepareMeasurementContext,
  splitAndWrap,
  truncateToWidth,
  wrapAndClip,
  wrapText,
  type FontSet,
  type MeasurementContext,
} from "./renderDocument";

/** One line of the statement: an invoice, a payment, or the opening balance. */
export type RenderStatementRow = {
  kind: "opening" | "invoice" | "payment";
  /** Local calendar day (YYYY-MM-DD). */
  on: string;
  /** What the row reads under Description -- already worded by the caller. */
  label: string;
  /** null draws an em dash: the opening-balance row charges and pays nothing. */
  chargeCents: number | null;
  paidCents: number | null;
  /** The running balance after this row. */
  balanceCents: number;
};

export type RenderStatementInput = {
  business: { name: string; address: string; phone: string; email: string; taxId: string };
  customer: { name: string; company: string; email: string; phone: string; address: string };
  /** Local calendar days (YYYY-MM-DD), inclusive both ends. */
  fromDay: string;
  toDay: string;
  /** Includes the opening-balance row as its first entry. */
  rows: RenderStatementRow[];
  closingBalanceCents: number;
  currency: string;
};

/** "1 Jan 2026 – 31 Mar 2026", in the workspace's own date format. */
export function statementPeriodLabel(fromDay: string, toDay: string, locale?: string): string {
  return `${formatDateDisplay(fromDay, locale)} – ${formatDateDisplay(toDay, locale)}`;
}

/**
 * The one sentence a statement closes on. "Nothing outstanding" reads as an
 * outcome, not a $0.00 line item -- the same F-LB-11c rule the receivables
 * screens follow: an empty state does not print a zero, it says the state.
 */
export function statementClosingSentence(
  closingBalanceCents: number,
  toDay: string,
  currency?: string,
  locale?: string,
): string {
  if (closingBalanceCents <= 0) return "Nothing outstanding.";
  return `${formatMoney(closingBalanceCents, currency, locale)} outstanding as of ${formatDateDisplay(toDay, locale)}.`;
}

/** The four cells one statement row draws, as plain strings -- pure, and what drawStatementRow renders verbatim. */
export function statementRowCells(
  row: RenderStatementRow,
  currency: string,
): { date: string; label: string; charge: string; paid: string; balance: string } {
  const dash = "—";
  return {
    date: formatDateDisplay(row.on),
    label: row.label,
    charge: row.chargeCents === null || row.chargeCents === 0 ? dash : formatMoney(row.chargeCents, currency),
    paid: row.paidCents === null || row.paidCents === 0 ? dash : formatMoney(row.paidCents, currency),
    balance: formatMoney(row.balanceCents, currency),
  };
}

// ---------------------------------------------------------------------------
// Column layout for the statement table: Date, Description, Charge, Paid,
// Balance -- narrower than the invoice's four-column line-item table, wider
// description column since a row has no wrapped second line under it.
// ---------------------------------------------------------------------------

type ColumnLayout = {
  dateColX: number;
  dateColWidth: number;
  descriptionColX: number;
  descriptionColWidth: number;
  chargeColRight: number;
  paidColRight: number;
  balanceColRight: number;
};

function buildColumnLayout(contentRight: number): ColumnLayout {
  const dateColWidth = 62;
  const chargeColWidth = 72;
  const paidColWidth = 72;
  const balanceColWidth = 80;
  const colGap = 10;

  const balanceColRight = contentRight;
  const paidColRight = balanceColRight - balanceColWidth - colGap;
  const chargeColRight = paidColRight - paidColWidth - colGap;
  const dateColX = PAGE_MARGIN;
  const descriptionColX = dateColX + dateColWidth + colGap;
  const descriptionColWidth = chargeColRight - chargeColWidth - colGap - descriptionColX;

  return {
    dateColX,
    dateColWidth,
    descriptionColX,
    descriptionColWidth,
    chargeColRight,
    paidColRight,
    balanceColRight,
  };
}

// ---------------------------------------------------------------------------
// Page sections.
// ---------------------------------------------------------------------------

function drawStatementHeader(
  page: PDFPage,
  fonts: FontSet,
  logoImage: PDFImage | null,
  input: RenderStatementInput,
  startY: number,
): number {
  const marginX = PAGE_MARGIN;
  const rightEdge = PAGE_WIDTH - PAGE_MARGIN;

  if (logoImage) {
    page.drawImage(logoImage, { x: marginX, y: startY - LOGO_SIZE, width: LOGO_SIZE, height: LOGO_SIZE });
  }

  const nameX = logoImage ? marginX + LOGO_SIZE + 12 : marginX;
  const nameSize = 22;
  const nameMaxWidth = rightEdge - 200 - nameX;
  const nameLine = wrapAndClip(input.business.name, fonts.headingBold, nameSize, Math.max(nameMaxWidth, 120), 1)[0] ?? "";
  page.drawText(nameLine, { x: nameX, y: startY - nameSize + 5, size: nameSize, font: fonts.headingBold, color: COLOR_NEAR_BLACK });

  // Title block, top right: "Statement", then the period.
  let titleY = startY;
  const titleSize = 18;
  const title = "Statement";
  const titleWidth = fonts.heading.widthOfTextAtSize(title, titleSize);
  page.drawText(title, { x: rightEdge - titleWidth, y: titleY - titleSize + 5, size: titleSize, font: fonts.heading, color: COLOR_NEAR_BLACK });
  titleY -= titleSize + 8;

  const periodSize = 9.5;
  drawRightAligned(
    page,
    statementPeriodLabel(input.fromDay, input.toDay),
    rightEdge,
    titleY,
    fonts.bodyBold,
    periodSize,
    COLOR_NEUTRAL_DARK,
  );
  titleY -= periodSize + 10;

  // Business contact block, left, under the name -- same two-paragraph shape
  // (address, then phone/email/tax id) the invoice header draws.
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

function drawStatementCustomerBlock(
  page: PDFPage,
  fonts: FontSet,
  input: RenderStatementInput,
  startY: number,
): number {
  let y = startY;
  drawSectionLabel(page, "Customer", PAGE_MARGIN, y, fonts.body);
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

  const detailSize = 9.5;
  const detailLines: string[] = [];
  if (billTo.company) detailLines.push(...wrapAndClip(billTo.company, fonts.body, detailSize, CONTENT_WIDTH, 1));
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

function drawStatementTableHeader(page: PDFPage, fonts: FontSet, startY: number, cols: ColumnLayout): number {
  const headerTop = startY;
  const headerHeight = TABLE_HEADER_HEIGHT;

  page.drawRectangle({ x: PAGE_MARGIN, y: headerTop - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: COLOR_NEUTRAL_LIGHT });

  const labelSize = 7.5;
  const baseline = headerTop - headerHeight / 2 - labelSize / 2 + 2;
  drawTrackedText(page, "DATE", cols.dateColX, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawTrackedText(page, "DESCRIPTION", cols.descriptionColX, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "CHARGE", cols.chargeColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "PAID", cols.paidColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);
  drawRightAlignedTracked(page, "BALANCE", cols.balanceColRight, baseline, fonts.body, labelSize, COLOR_MUTED, 1);

  const bottom = headerTop - headerHeight;
  page.drawRectangle({ x: PAGE_MARGIN, y: bottom - HAIRLINE_THICKNESS, width: CONTENT_WIDTH, height: HAIRLINE_THICKNESS, color: COLOR_HAIRLINE });
  return bottom - HAIRLINE_THICKNESS - 8;
}

function measureRowHeight(): number {
  return ROW_HEIGHT;
}

function drawStatementRow(
  page: PDFPage,
  fonts: FontSet,
  row: RenderStatementRow,
  currency: string,
  startY: number,
  cols: ColumnLayout,
): number {
  const size = 9.5;
  const baseline = startY - size;
  const cells = statementRowCells(row, currency);
  const emphasize = row.kind === "opening";
  const labelFont = emphasize ? fonts.bodyBold : fonts.body;
  const labelColor = emphasize ? COLOR_NEAR_BLACK : COLOR_NEUTRAL_DARK;

  page.drawText(cells.date, { x: cols.dateColX, y: baseline, size, font: fonts.body, color: COLOR_NEUTRAL_DARK });
  const labelText = truncateToWidth(cells.label, labelFont, size, cols.descriptionColWidth);
  page.drawText(labelText, { x: cols.descriptionColX, y: baseline, size, font: labelFont, color: labelColor });
  drawRightAligned(page, cells.charge, cols.chargeColRight, baseline, fonts.body, size, COLOR_NEUTRAL_DARK);
  drawRightAligned(page, cells.paid, cols.paidColRight, baseline, fonts.body, size, COLOR_NEUTRAL_DARK);
  drawRightAligned(page, cells.balance, cols.balanceColRight, baseline, fonts.bodyBold, size, COLOR_NEAR_BLACK);

  return startY - measureRowHeight();
}

/**
 * The closing-balance block: the one confident filled colour on the page,
 * same treatment as the invoice PDF's total/balance-due row, then the
 * one-sentence closing line underneath in plain ink.
 */
function drawClosingBalance(
  page: PDFPage,
  fonts: FontSet,
  input: RenderStatementInput,
  startY: number,
  contentRight: number,
): number {
  const boxWidth = 220;
  const boxX = contentRight - boxWidth;
  const totalHeight = 30;
  const totalTop = startY;
  const totalBottom = totalTop - totalHeight;

  page.drawRectangle({ x: boxX, y: totalBottom, width: boxWidth, height: totalHeight, color: COLOR_PRIMARY });
  const totalSize = 12;
  const totalBaseline = totalBottom + (totalHeight - totalSize) / 2 + 2;
  page.drawText("Closing balance", { x: boxX + 14, y: totalBaseline, size: totalSize, font: fonts.bodyBold, color: COLOR_ON_PRIMARY });
  drawRightAligned(
    page,
    formatMoney(input.closingBalanceCents, input.currency),
    contentRight - 14,
    totalBaseline,
    fonts.bodyBold,
    totalSize,
    COLOR_ON_PRIMARY,
  );

  let y = totalBottom - 20;
  const sentenceSize = 10;
  const sentence = statementClosingSentence(input.closingBalanceCents, input.toDay, input.currency);
  page.drawText(sentence, { x: boxX, y, size: sentenceSize, font: fonts.body, color: COLOR_NEUTRAL_DARK });
  y -= sentenceSize;

  return y - 14;
}

function drawStatementFooter(page: PDFPage, fonts: FontSet, footerLabel: string, pageNumber: number, pageCount: number): void {
  const size = 8;
  page.drawText(footerLabel, { x: PAGE_MARGIN, y: FOOTER_BASELINE_Y, size, font: fonts.body, color: COLOR_MUTED });
  drawRightAligned(page, `Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - PAGE_MARGIN, FOOTER_BASELINE_Y, fonts.body, size, COLOR_MUTED);
}

// ---------------------------------------------------------------------------
// Page planning: measured, not counted -- the same approach renderDocument.ts
// uses (F-LB-21), reusing its measurement scaffolding.
// ---------------------------------------------------------------------------

type PageStartYs = { firstPage: number; continuation: number };

function measurePageStartYs(
  measurement: MeasurementContext,
  input: RenderStatementInput,
  cols: ColumnLayout,
): PageStartYs {
  const { fonts, logoImage } = measurement;

  const firstPage = measureOnScratchPage(measurement, (page) => {
    let y = PAGE_HEIGHT - PAGE_MARGIN;
    y = drawStatementHeader(page, fonts, logoImage, input, y);
    y = drawHairline(page, y);
    y = drawStatementCustomerBlock(page, fonts, input, y);
    y = drawHairline(page, y);
    return drawStatementTableHeader(page, fonts, y, cols);
  });

  const continuation = measureOnScratchPage(measurement, (page) =>
    drawStatementTableHeader(page, fonts, PAGE_HEIGHT - PAGE_MARGIN, cols),
  );

  return { firstPage, continuation };
}

function measureClosingBlockHeight(measurement: MeasurementContext, input: RenderStatementInput, contentRight: number): number {
  const { fonts } = measurement;
  const reference = PAGE_HEIGHT;
  return measureOnScratchPage(measurement, (page) => {
    let y = reference - 14;
    y = drawClosingBalance(page, fonts, input, y, contentRight);
    return reference - y;
  });
}

function planPages(input: RenderStatementInput, startYs: PageStartYs, closingBlockHeight: number): RenderStatementRow[][] {
  const pages: RenderStatementRow[][] = [];
  let current: RenderStatementRow[] = [];
  let cursorY = startYs.firstPage;

  for (const row of input.rows) {
    const height = measureRowHeight();
    if (current.length > 0 && cursorY - height < CONTENT_BOTTOM_LIMIT) {
      pages.push(current);
      current = [];
      cursorY = startYs.continuation;
    }
    current.push(row);
    cursorY -= height;
  }
  pages.push(current);

  if (cursorY - closingBlockHeight < CONTENT_BOTTOM_LIMIT) {
    pages.push([]);
  }

  return pages;
}

type RenderContext = {
  doc: PDFDocument;
  fonts: FontSet;
  logoImage: PDFImage | null;
  contentRight: number;
  cols: ColumnLayout;
  measurement: MeasurementContext;
};

async function prepareRenderContext(assets?: DocumentAssets): Promise<RenderContext> {
  const resolvedAssets = assets ?? (await loadAssets());
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

  const contentRight = PAGE_WIDTH - PAGE_MARGIN;
  const cols = buildColumnLayout(contentRight);
  const measurement = await prepareMeasurementContext(resolvedAssets);

  return { doc, fonts, logoImage, contentRight, cols, measurement };
}

/** Same diagnostic shape as renderDocument's planPageLayout, for the same reason: pdf-lib cannot read a drawn coordinate back out of a saved PDF. */
export type StatementPageLayoutPlan = {
  pageCount: number;
  rowsPerPage: number[];
  contentBottomYPerPage: number[];
};

export async function planStatementLayout(
  input: RenderStatementInput,
  assets?: DocumentAssets,
): Promise<StatementPageLayoutPlan> {
  const { contentRight, cols, measurement } = await prepareRenderContext(assets);

  const startYs = measurePageStartYs(measurement, input, cols);
  const closingBlockHeight = measureClosingBlockHeight(measurement, input, contentRight);
  const pages = planPages(input, startYs, closingBlockHeight);

  const contentBottomYPerPage = pages.map((rows, index) => {
    const startY = index === 0 ? startYs.firstPage : startYs.continuation;
    const afterRows = rows.reduce((y) => y - measureRowHeight(), startY);
    const isLastPage = index === pages.length - 1;
    return isLastPage ? afterRows - closingBlockHeight : afterRows;
  });

  return {
    pageCount: pages.length,
    rowsPerPage: pages.map((rows) => rows.length),
    contentBottomYPerPage,
  };
}

export async function renderStatement(input: RenderStatementInput, assets?: DocumentAssets): Promise<Uint8Array> {
  const { doc, fonts, logoImage, contentRight, cols, measurement } = await prepareRenderContext(assets);

  doc.setTitle(`Statement ${statementPeriodLabel(input.fromDay, input.toDay)}`);
  doc.setProducer("Helix CRM");

  const startYs = measurePageStartYs(measurement, input, cols);
  const closingBlockHeight = measureClosingBlockHeight(measurement, input, contentRight);
  const pages = planPages(input, startYs, closingBlockHeight);
  const pageCount = pages.length;

  const footerLabel = `Statement · ${statementPeriodLabel(input.fromDay, input.toDay)}`;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === pageCount - 1;

    let cursorY = PAGE_HEIGHT - PAGE_MARGIN;

    if (isFirstPage) {
      cursorY = drawStatementHeader(page, fonts, logoImage, input, cursorY);
      cursorY = drawHairline(page, cursorY);
      cursorY = drawStatementCustomerBlock(page, fonts, input, cursorY);
      cursorY = drawHairline(page, cursorY);
    }

    cursorY = drawStatementTableHeader(page, fonts, cursorY, cols);

    for (const row of pages[pageIndex]) {
      cursorY = drawStatementRow(page, fonts, row, input.currency, cursorY, cols);
    }

    if (isLastPage) {
      cursorY -= 14;
      cursorY = drawClosingBalance(page, fonts, input, cursorY, contentRight);
    }

    drawStatementFooter(page, fonts, footerLabel, pageIndex + 1, pageCount);
  }

  return doc.save();
}
