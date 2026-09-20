/**
 * Landscaping: design-build, maintenance contracts and seasonal cleanups.
 *
 * The owner quotes a property, walks it, sends a number, schedules a crew. The
 * work is a job from the moment it is sold, so "Jobs" is the word, and the
 * stages are the five things that actually happen between a form fill and a
 * paid invoice.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "landscaping",
  label: "Landscaping",
  vocabulary: "jobs",
  vocabularyWhy: "You sell work that a crew shows up and does, so it is a job.",
  stages: [
    { name: "New lead", quietDays: 3 },
    { name: "Walked the property", quietDays: 5 },
    { name: "Estimate sent", quietDays: 7 },
    { name: "Scheduled", quietDays: 14 },
    { name: "Work done", quietDays: 10 },
    { name: "Paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Drive-by", kind: "manual" },
    { name: "Repeat customer", kind: "manual" },
  ],
  fields: [
    {
      name: "Property size",
      kind: "choice",
      entityType: "deal",
      options: ["Under 1/4 acre", "1/4 to 1/2 acre", "1/2 to 1 acre", "Over an acre"],
    },
    {
      name: "Service type",
      kind: "choice",
      entityType: "deal",
      options: ["Design and install", "Maintenance", "Sprinklers", "Cleanup", "Hardscape"],
    },
    { name: "Gate code", kind: "text", entityType: "contact" },
  ],
};

export default preset;
