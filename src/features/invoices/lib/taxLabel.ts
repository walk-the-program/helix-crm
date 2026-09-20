/**
 * The tax row's label, and whether it prints at all.
 *
 * A flat "Tax (8.25%)" line is honest only when every line on the document
 * carries that rate. The moment some lines are taxable and some are not, the
 * same label sits over a number that is not 8.25% of the subtotal above it -
 * which is exactly what reads as a bug (docs/DESIGN.md section 11: specific,
 * not vague). Naming the taxed amount fixes that: "Tax (8.25% on $174.00)"
 * is the arithmetic the row is actually doing.
 *
 * A document with no taxable lines - or a rate that comes out to zero tax -
 * never prints a tax row at all: a "$0.00 tax" line answers a question
 * nobody asked.
 *
 * One pure module so the PDF, the document page and the new-document screen
 * cannot drift into describing the same total three different ways.
 */

export type TaxLine = {
  taxable: boolean;
  amountCents: number;
};

export type TaxLineSummary = {
  taxableCount: number;
  lineCount: number;
  /** Sum of the taxable lines' own amounts - what the percentage is actually taken of. */
  taxableCents: number;
};

/** Tallies a document's lines once, for both the totals row and the per-line tags. */
export function summarizeTaxLines(lines: TaxLine[]): TaxLineSummary {
  let taxableCount = 0;
  let taxableCents = 0;
  for (const line of lines) {
    if (line.taxable) {
      taxableCount += 1;
      taxableCents += line.amountCents;
    }
  }
  return { taxableCount, lineCount: lines.length, taxableCents };
}

/**
 * True only when the document has both taxable and non-taxable lines - the
 * one case that needs the taxed amount spelled out, and the one case where
 * each line needs its own "Taxable" mark.
 */
export function hasMixedTaxability(summary: TaxLineSummary): boolean {
  return summary.taxableCount > 0 && summary.taxableCount < summary.lineCount;
}

export type TaxRowState = { show: false } | { show: true; label: string };

/**
 * `percentText` and `formatAmount` come from the caller so this stays pure:
 * the PDF renderer and the two screens each already format a percent and a
 * money amount their own way, and this helper does not need to agree with
 * either - it only decides what the row says, not how a number is spelled.
 */
export function taxRowLabel(
  summary: TaxLineSummary,
  taxCents: number,
  percentText: string,
  formatAmount: (cents: number) => string,
): TaxRowState {
  if (summary.taxableCount === 0 || taxCents === 0) return { show: false };
  if (!hasMixedTaxability(summary)) {
    return { show: true, label: `Tax (${percentText})` };
  }
  return { show: true, label: `Tax (${percentText} on ${formatAmount(summary.taxableCents)})` };
}
