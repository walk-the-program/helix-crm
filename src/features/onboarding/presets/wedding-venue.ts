/**
 * Wedding venue: tours, date holds and packages for one event at a time.
 *
 * Every couple wants the same two numbers before anything else — is their
 * date open, and what will the room cost with their headcount — so what the
 * venue sends back is a quote for that one Saturday, not a standing price
 * list. Date and guest count get their own fields because the venue cannot
 * answer either question without them.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "wedding-venue",
  label: "Wedding venue",
  vocabulary: "quotes",
  vocabularyWhy: "A couple wants a price for their date and headcount, so it is a quote.",
  stages: [
    { name: "New inquiry", quietDays: 3 },
    { name: "Tour booked", quietDays: 5 },
    { name: "Toured", quietDays: 7 },
    { name: "Quote sent", quietDays: 10 },
    { name: "Deposit paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Vendor referral", kind: "referral" },
    { name: "Wedding directory", kind: "manual" },
    { name: "Instagram", kind: "manual" },
  ],
  fields: [
    { name: "Event date", kind: "date", entityType: "deal" },
    { name: "Guest count", kind: "number", entityType: "deal" },
    {
      name: "Package interest",
      kind: "choice",
      entityType: "deal",
      options: ["All-inclusive", "Venue only", "Elopement", "Rehearsal dinner"],
    },
  ],
};

export default preset;
