/**
 * Home services: plumbing, HVAC and electrical, mostly dispatched same day.
 *
 * The phone rings, someone gets sent out, and the thing that gets sold is
 * whatever that tech does at the house — a job, exactly the way the owner
 * already says it. Emergency calls and routine calls move through the same
 * five steps, so the field that actually varies is urgency, not the pipeline.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "home-services",
  label: "Home services",
  vocabulary: "jobs",
  vocabularyWhy: "A tech drives out and does the work, so it is a job, same as always.",
  stages: [
    { name: "New call", quietDays: 3 },
    { name: "Dispatched", quietDays: 5 },
    { name: "Estimate given", quietDays: 7 },
    { name: "Scheduled", quietDays: 14 },
    { name: "Work done", quietDays: 10 },
    { name: "Paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Emergency call-in", kind: "manual" },
    { name: "Repeat customer", kind: "manual" },
  ],
  fields: [
    {
      name: "Job type",
      kind: "choice",
      entityType: "deal",
      options: ["Plumbing", "HVAC", "Electrical", "Other"],
    },
    {
      name: "Urgency",
      kind: "choice",
      entityType: "deal",
      options: ["Routine", "Same day", "Emergency"],
    },
  ],
  services: [
    { name: "Diagnostic visit", kind: "one_time", interval: null, unitPriceCents: 8900 },
    { name: "Drain cleaning", kind: "one_time", interval: null, unitPriceCents: 22500 },
    { name: "Water heater installation", kind: "one_time", interval: null, unitPriceCents: 180000 },
    { name: "HVAC tune-up", kind: "one_time", interval: null, unitPriceCents: 15000 },
    { name: "Annual service plan", kind: "recurring", interval: "year", unitPriceCents: 24900 },
  ],
};

export default preset;
