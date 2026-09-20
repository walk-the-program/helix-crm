/**
 * CrossFit gym: a free class or on-ramp that turns into a membership.
 *
 * Like the studio down the street, nobody is quoted a price for a one-off
 * job here — someone tries the gym and either joins or does not, so the
 * plain word carries it. The two things a coach actually wants to know
 * before that first class are what membership they are considering and how
 * much experience they are walking in with.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "crossfit-gym",
  label: "CrossFit gym",
  vocabulary: "deals",
  vocabularyWhy: "A new member joins for training, not a one-off job, so deal is the plain word.",
  stages: [
    { name: "New signup", quietDays: 3 },
    { name: "Reached out", quietDays: 5 },
    { name: "On-ramp booked", quietDays: 7 },
    { name: "On-ramp complete", quietDays: 10 },
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
      options: ["Drop-in", "On-ramp", "Unlimited monthly", "Not sure yet"],
    },
    {
      name: "Fitness background",
      kind: "choice",
      entityType: "contact",
      options: ["New to CrossFit", "Some experience", "Competitive athlete"],
    },
  ],
  services: [
    { name: "Drop-in class", kind: "one_time", interval: null, unitPriceCents: 2500 },
    { name: "On-ramp program", kind: "one_time", interval: null, unitPriceCents: 15000 },
    { name: "Personal training session", kind: "one_time", interval: null, unitPriceCents: 7500 },
    { name: "Monthly unlimited membership", kind: "recurring", interval: "month", unitPriceCents: 17500 },
  ],
};

export default preset;
