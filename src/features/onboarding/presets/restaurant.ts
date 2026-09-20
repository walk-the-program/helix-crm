/**
 * Restaurant: private dining, buyouts and catering booked around the regular
 * service.
 *
 * A party wants the room for an evening, and before anyone reserves it the
 * owner sends back a price for the space and the menu — a quote, the same
 * word a caterer would use. Guest count and a preferred date get their own
 * fields because a private-dining request cannot be priced without them.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "restaurant",
  label: "Restaurant",
  vocabulary: "quotes",
  vocabularyWhy: "A private party wants a price for the room and the menu, so it is a quote.",
  stages: [
    { name: "New inquiry", quietDays: 3 },
    { name: "Details gathered", quietDays: 5 },
    { name: "Quote sent", quietDays: 7 },
    { name: "Booked", quietDays: 14 },
    { name: "Event held", quietDays: 10 },
    { name: "Paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Walk-in guest", kind: "manual" },
    { name: "Instagram", kind: "manual" },
  ],
  fields: [
    {
      name: "Event type",
      kind: "choice",
      entityType: "deal",
      options: ["Private dining", "Full buyout", "Catering drop-off", "Rehearsal dinner", "Other"],
    },
    { name: "Guest count", kind: "number", entityType: "deal" },
    { name: "Preferred date", kind: "date", entityType: "deal" },
  ],
  services: [
    { name: "Private dining room rental", kind: "one_time", interval: null, unitPriceCents: 50000 },
    { name: "Full restaurant buyout", kind: "one_time", interval: null, unitPriceCents: 500000 },
    { name: "Catering drop-off, per person", kind: "one_time", interval: null, unitPriceCents: 2800 },
    { name: "Rehearsal dinner package", kind: "one_time", interval: null, unitPriceCents: 120000 },
  ],
};

export default preset;
