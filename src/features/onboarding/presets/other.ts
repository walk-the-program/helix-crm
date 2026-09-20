/**
 * Other: the trade that is not on the grid.
 *
 * Deliberately plain. Five stages every service business recognises, the three
 * places work comes from, and two details almost everyone writes down. The
 * owner renames the lot on screen 2 in about twenty seconds, which is the point
 * of showing a preset rather than an empty form.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "other",
  label: "Something else",
  vocabulary: "deals",
  vocabularyWhy: "Neutral, until you tell us what you call the work you sell.",
  stages: [
    { name: "New enquiry", quietDays: 3 },
    { name: "Talked to them", quietDays: 5 },
    { name: "Price sent", quietDays: 7 },
    { name: "Booked", quietDays: 14 },
    { name: "Won", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Phone call", kind: "manual" },
  ],
  fields: [
    { name: "What they need", kind: "text", entityType: "deal" },
    { name: "How they found you", kind: "text", entityType: "contact" },
  ],
  services: [
    { name: "Initial consultation", kind: "one_time", interval: null, unitPriceCents: 5000 },
    { name: "Standard service", kind: "one_time", interval: null, unitPriceCents: 15000 },
    { name: "Premium package", kind: "one_time", interval: null, unitPriceCents: 50000 },
    { name: "Monthly plan", kind: "recurring", interval: "month", unitPriceCents: 9900 },
  ],
};

export default preset;
