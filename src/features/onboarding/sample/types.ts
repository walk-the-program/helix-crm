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
};

/** The tag every sample row carries, and the one thing removal looks for. */
export const SAMPLE_TAG = "Sample";
