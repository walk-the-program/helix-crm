/**
 * Church: first-time visitors, prayer requests and the follow-up after both.
 *
 * A church is not selling anything, so none of the trade words fit and the
 * plain one is the honest choice — the stage names are where the real
 * meaning lives instead. The pipeline tracks the same thing the office
 * already does by hand: someone new showed up or reached out, and staff
 * follow up until that person is either part of the church or gone quiet.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "church",
  label: "Church",
  vocabulary: "deals",
  vocabularyWhy: "Nothing here is being sold, so the plain word stays out of the way.",
  stages: [
    { name: "New visit request", quietDays: 3 },
    { name: "Reached out", quietDays: 5 },
    { name: "Visited a service", quietDays: 7 },
    { name: "Followed up", quietDays: 10 },
    { name: "Joined the church", quietDays: 30, isWon: true },
    { name: "Lost touch", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Member invite", kind: "referral" },
    { name: "Walk-in", kind: "manual" },
    { name: "Community event", kind: "manual" },
  ],
  fields: [
    {
      name: "Reason for visiting",
      kind: "choice",
      entityType: "deal",
      options: ["First time visitor", "Looking for a church home", "Prayer request", "Baptism or wedding", "Other"],
    },
    {
      name: "Best way to reach them",
      kind: "choice",
      entityType: "contact",
      options: ["Call", "Text", "Email"],
    },
  ],
  services: [
    { name: "Sanctuary rental", kind: "one_time", interval: null, unitPriceCents: 50000 },
    { name: "Fellowship hall rental", kind: "one_time", interval: null, unitPriceCents: 25000 },
    { name: "Wedding ceremony fee", kind: "one_time", interval: null, unitPriceCents: 75000 },
    { name: "Premarital counseling session", kind: "one_time", interval: null, unitPriceCents: 7500 },
  ],
};

export default preset;
