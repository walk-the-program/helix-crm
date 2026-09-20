/**
 * What a sample data set is.
 *
 * "Show me an example" fills the workspace with a working week from the owner's
 * own trade, so the first thing he sees is Today with real rows on it rather
 * than four empty panels. Every row is invented: the names are made up, every
 * address is a street that could be anywhere, every email is on a `.example`
 * domain that can never resolve, and every phone number is in the
 * 801-555-01xx block reserved for fiction.
 *
 * Dates are relative, never absolute, so a set is as current in a year as it is
 * today. Money is whole dollars here and integer cents in the database.
 *
 * Everything loaded this way carries the tag "Sample", which is what
 * "Remove sample data" hunts for. Nothing outside a set ever gets that tag.
 *
 * Invariants, enforced by `tests/unit/onboarding/sample.test.ts`:
 *  - 12 to 20 contacts;
 *  - 6 to 10 companies, or none at all where the trade sells to people;
 *  - 8 to 12 deals, each one in a stage the trade's preset defines;
 *  - 15 to 25 activities;
 *  - 6 to 10 tasks, at least two of them overdue;
 *  - every email ends in `.example`, every phone is 801-555-01xx and unique;
 *  - every key a row refers to exists;
 *  - a date field's value is a day offset ("+120"), never a fixed calendar date.
 */
import type { TradeId } from "../presets/types";

export type SampleCompany = {
  /** Referred to by contacts and deals. Unique inside one set. */
  key: string;
  name: string;
  website?: string;
  /** "(801) 555-0142" */
  phone?: string;
  notes?: string;
};

export type SampleContact = {
  key: string;
  firstName: string;
  lastName: string;
  companyKey?: string;
  /** Anything on a `.example` domain, which can never reach a real inbox. */
  email?: string;
  phone?: string;
  notes?: string;
  /**
   * Custom field name (as the preset spells it) to value. A `choice` field takes
   * one of its own options; a `date` field takes a signed day offset written as
   * a string ("+120", "-3"), which the loader turns into a real date — so a set
   * stays as current in a year as it is today.
   */
  fields?: Record<string, string>;
};

/**
 * One priced line on a sample deal (R9).
 *
 * Until this existed a sample deal carried a typed `value` and nothing else,
 * so the whole money half of the product demoed as an empty state: /services
 * said "No deals" against every service, every deal page said "Nothing priced
 * yet", and Invoiced and Collected were $0 on every strip and every report.
 *
 * A set is not expected to price every deal. A real owner has costed some jobs
 * properly and scribbled a number on the others, and both states have to look
 * right, so a deal with no `items` keeps its typed `value` exactly as before.
 */
export type SampleDealItem = {
  /**
   * A service name from the trade's preset, matched exactly. The loader finds
   * the product it created for that preset row and links `product_id`, so the
   * Services page's deal counts are real. Leave it out for a custom line —
   * work that was never in the catalogue, which is the other half of how an
   * owner prices a job.
   */
  service?: string;
  /** Required on a custom line; otherwise the service's own name is used. */
  name?: string;
  description?: string;
  /** Defaults to 1. */
  qty?: number;
  /**
   * Whole dollars, and only when the owner charged something other than the
   * catalogue price — that difference is what puts a real discount row on the
   * deal page instead of a hypothetical one.
   */
  actualPrice?: number;
  /** Whole dollars. Required on a custom line, ignored on a catalogue line. */
  price?: number;
};

/** A quote or invoice the sample week already raised against a deal (R9). */
export type SampleDocument = {
  kind: "quote" | "invoice";
  /** The deal it belongs to. Every document belongs to a deal (round 3). */
  dealKey: string;
  status: "sent" | "paid";
  /**
   * Which of the deal's lines go on it. "one_time" is what an invoice for the
   * work carries: the recurring lines are billed month by month by the
   * schedule, and putting them on this invoice as well would bill them twice.
   */
  lines: "all" | "one_time";
  /** Days ago it was issued. */
  issuedDaysAgo: number;
  /** Days from issue to the due date. 14 is the workspace default. */
  dueInDays?: number;
  /** Days ago the money arrived. Required when `status` is "paid". */
  paidDaysAgo?: number;
  paidMethod?: "bank" | "card" | "cash" | "cheque" | "other";
};

export type SampleDeal = {
  key: string;
  title: string;
  /** Whole dollars. The loader turns it into cents. */
  value: number;
  /** A stage name from the trade's preset. */
  stage: string;
  contactKey?: string;
  companyKey?: string;
  /** A source name from the trade's preset. Defaults to the first one. */
  sourceName?: string;
  /** How long ago it arrived, and how long it has sat in its stage. */
  ageDays: number;
  stageDays?: number;
  /** Days from now the owner expects to close it. */
  expectedInDays?: number;
  fields?: Record<string, string>;
  /**
   * The priced lines, if this deal was costed. When present the loader calls
   * `dealItems.recompute`, which is the only writer of `value_cents`, so the
   * lines are the source of truth and `value` above is only the figure the
   * deal carries until they land. Keep the two in step: every set's invariant
   * test checks that a priced deal's lines add up to its stated value.
   */
  items?: SampleDealItem[];
};

export type SampleActivity = {
  kind: "note" | "call" | "email" | "meeting" | "text";
  body: string;
  daysAgo: number;
  contactKey?: string;
  companyKey?: string;
  dealKey?: string;
};

export type SampleTask = {
  title: string;
  /** Negative is overdue, 0 is today. */
  dueInDays: number;
  contactKey?: string;
  companyKey?: string;
  dealKey?: string;
  done?: boolean;
};

export type SampleSet = {
  trade: TradeId;
  companies: SampleCompany[];
  contacts: SampleContact[];
  deals: SampleDeal[];
  activities: SampleActivity[];
  tasks: SampleTask[];
  /**
   * Quotes and invoices already raised against the set's deals. Optional: a
   * trade whose sample has not been given money yet simply has none, and
   * loads exactly as it did before (R9).
   */
  documents?: SampleDocument[];
};

/** The tag every sample row carries, and the one thing removal looks for. */
export const SAMPLE_TAG = "Sample";
