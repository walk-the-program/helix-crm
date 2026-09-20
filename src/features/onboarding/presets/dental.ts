/**
 * Dental: a family practice, new patients and recall visits alike.
 *
 * Nothing gets scheduled until the front desk tells someone what it costs, so
 * "quote" is the honest word for what goes out before the chair time is
 * booked. The two details every dentist keeps on a patient — who covers them
 * and who they like doing the cleaning — get their own fields because no
 * generic CRM column fits either one.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "dental",
  label: "Dental",
  vocabulary: "quotes",
  vocabularyWhy: "A patient asks what a crown costs before saying yes, so it is a quote.",
  stages: [
    { name: "New inquiry", quietDays: 3 },
    { name: "Consult booked", quietDays: 5 },
    { name: "Treatment plan sent", quietDays: 7 },
    { name: "Scheduled", quietDays: 14 },
    { name: "Seen", quietDays: 10 },
    { name: "Paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Existing patient", kind: "manual" },
    { name: "Walk-in", kind: "manual" },
  ],
  fields: [
    { name: "Insurance", kind: "text", entityType: "contact" },
    { name: "Preferred hygienist", kind: "text", entityType: "contact" },
    {
      name: "Treatment interest",
      kind: "choice",
      entityType: "deal",
      options: ["Cleaning", "Whitening", "Clear aligners", "Crown or bridge", "Emergency", "Other"],
    },
  ],
};

export default preset;
