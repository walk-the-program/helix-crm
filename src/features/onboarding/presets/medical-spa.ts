/**
 * Medical spa: injectables, laser and facials at a boutique aesthetic clinic.
 *
 * Everything is priced by the unit or the session, so the number a
 * coordinator sends before booking is a quote, not an invoice for work
 * already done. No field here stores what a client is being treated for —
 * only what they asked about and who they would rather see, which is as far
 * as the front desk needs to go.
 */
import type { TradePreset } from "./types";

export const preset: TradePreset = {
  id: "medical-spa",
  label: "Medical spa",
  vocabulary: "quotes",
  vocabularyWhy: "Injectables are priced by the unit, so what goes out first is a quote.",
  stages: [
    { name: "New inquiry", quietDays: 3 },
    { name: "Consult booked", quietDays: 5 },
    { name: "Quote sent", quietDays: 7 },
    { name: "Scheduled", quietDays: 14 },
    { name: "Treated", quietDays: 10 },
    { name: "Paid", quietDays: 30, isWon: true },
    { name: "Lost", quietDays: 30, isLost: true },
  ],
  sources: [
    { name: "Website", kind: "website" },
    { name: "Referral", kind: "referral" },
    { name: "Instagram", kind: "manual" },
    { name: "Existing client", kind: "manual" },
  ],
  fields: [
    {
      name: "Treatment interest",
      kind: "choice",
      entityType: "deal",
      options: ["Injectables", "Laser", "Facial", "Body contouring", "Membership", "Other"],
    },
    { name: "Preferred provider", kind: "text", entityType: "contact" },
  ],
};

export default preset;
