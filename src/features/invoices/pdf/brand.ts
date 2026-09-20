/**
 * Colour and page-metric constants for the invoice/quote PDF renderer.
 *
 * This is the ONE place in this feature allowed to hold colour literals.
 * docs/DESIGN.md says no hex or rgba colour may appear anywhere in the
 * codebase except src/styles/tokens.css -- but a PDF page is not CSS, it
 * cannot read a custom property, and pdf-lib wants floats in the 0-1 range
 * rather than hex strings. These are the same five brand values from
 * tokens.css / docs/DESIGN.md section 5 ("Colour"), converted once, here,
 * for pdf-lib's rgb() helper.
 */
import { rgb } from "pdf-lib";
import type { RGB } from "pdf-lib";

// ---------------------------------------------------------------------------
// Brand colours (docs/DESIGN.md section 5, "The brand" / "The one filled
// control"). Values match --brand-primary, --brand-neutral-dark,
// --brand-neutral-light and the near-black canvas ink in tokens.css.
// ---------------------------------------------------------------------------

/** #97B1C3 -- the one confident filled block (the total row, and nothing else). */
export const COLOR_PRIMARY: RGB = rgb(0.592, 0.694, 0.765);

/** #4E555A -- body ink. */
export const COLOR_NEUTRAL_DARK: RGB = rgb(0.306, 0.333, 0.353);

/** #FAFAFF -- the quiet fill behind the table header and (were it needed) totals. */
export const COLOR_NEUTRAL_LIGHT: RGB = rgb(0.980, 0.980, 1.0);

/** #141414 -- headings, and the ink that sits on the primary fill (8.24:1). */
export const COLOR_NEAR_BLACK: RGB = rgb(0.078, 0.078, 0.078);

/**
 * Hairline colour: the neutral dark blended toward white at 14%, matching
 * --color-border in tokens.css (`rgba(78,85,90,0.14)` over a white page).
 * Pre-mixed to a flat colour because a PDF hairline is an opaque rectangle,
 * not a translucent layer.
 */
const HAIRLINE_MIX = 0.14;
export const COLOR_HAIRLINE: RGB = rgb(
  1 - HAIRLINE_MIX * (1 - 0.306),
  1 - HAIRLINE_MIX * (1 - 0.333),
  1 - HAIRLINE_MIX * (1 - 0.353),
);

/** Muted ink for footers, per-line "per month"/"per year" tags, and captions. */
export const COLOR_MUTED = COLOR_NEUTRAL_DARK;

/** Ink drawn on top of COLOR_PRIMARY -- always the near-black, never white. */
export const COLOR_ON_PRIMARY: RGB = COLOR_NEAR_BLACK;

// ---------------------------------------------------------------------------
// Page metrics. US Letter, 54pt margins.
// ---------------------------------------------------------------------------

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const PAGE_MARGIN = 54;

export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

/** Maximum table line rows before a page break. */
export const LINES_PER_PAGE = 18;

/** Height of one table row with a single line of text, in points. */
export const ROW_HEIGHT = 20;

/** Extra height a row gets when its line has a description (up to two wrapped lines under the name). */
export const ROW_DESCRIPTION_EXTRA = 20;

/** Height of the table header row. */
export const TABLE_HEADER_HEIGHT = 20;

/** Height reserved for the header block (logo, business name/address, title block). */
export const HEADER_HEIGHT = 140;

/** Height reserved for the customer block. */
export const CUSTOMER_BLOCK_HEIGHT = 90;

/** Baseline y-position of the footer text, measured from the page bottom. */
export const FOOTER_BASELINE_Y = 28;

/** Size, in points, of the small logo mark in the header. */
export const LOGO_SIZE = 34;

/** Thickness used for all hairlines. */
export const HAIRLINE_THICKNESS = 0.75;
