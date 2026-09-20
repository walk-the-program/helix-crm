/**
 * Pilates studio: an intro offer that turns a first reformer class into a
 * membership.
 *
 * Nobody gets a job done and nobody gets quoted a price up front — someone
 * tries a class and, if it sticks, joins — so the plain word is the honest
 * one here too. What matters for the front desk is which membership they are
 * leaning toward and when they can actually make it to class.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "pilates-studio",
  label: "Pilates studio",
  vocabulary: "deals",
  vocabularyWhy: "A new client signs up for a membership, not a job or a quote, so deal fits.",
  stages: [
    { name: "New intro signup", quietDays: 3 },
    { name: "Reached out", quietDays: 5 },
    { name: "First class booked", quietDays: 7 },
    { name: "Attended first class", quietDays: 10 },
    { name: "Membership sold", quietDays: 30, isWon: true },
    { name: "Went cold", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Member referral", kind: "referral" },
    { name: "Instagram", kind: "manual" },
    { name: "Walk-in", kind: "manual" },
  ],
  fields: [
    {
      name: "Membership interest",
      kind: "choice",
      entityType: "deal",
      options: ["Drop-in", "Class pack", "Unlimited monthly", "Not sure yet"],
    },
    {
      name: "Preferred class time",
      kind: "choice",
      entityType: "contact",
      options: ["Morning", "Midday", "Evening", "Weekend"],
    },
  ],
  services: [
    { name: "Drop-in class", kind: "one_time", interval: null, unitPriceCents: 3200 },
    { name: "Class pack of five", kind: "one_time", interval: null, unitPriceCents: 14000 },
    { name: "Private session", kind: "one_time", interval: null, unitPriceCents: 9500 },
    { name: "Monthly unlimited membership", kind: "recurring", interval: "month", unitPriceCents: 19900 },
  ],
};

export default preset;
