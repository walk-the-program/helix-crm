/**
 * The ten presets, and the grid the owner picks from on screen 1.
 *
 * Nine trades are the ones ClearPath builds sites for, so the words here are
 * the words on those sites; "Something else" is the tenth and takes a
 * free-text line instead of a preset's name.
 */
import type { TradeId, TradePreset } from "./types";
import { preset as landscaping } from "./landscaping";
import { preset as homeServices } from "./home-services";
import { preset as dental } from "./dental";
import { preset as medicalSpa } from "./medical-spa";
import { preset as weddingVenue } from "./wedding-venue";
import { preset as church } from "./church";
import { preset as restaurant } from "./restaurant";
import { preset as pilatesStudio } from "./pilates-studio";
import { preset as crossfitGym } from "./crossfit-gym";
import { preset as other } from "./other";

export const PRESETS: Record<TradeId, TradePreset> = {
  landscaping,
  "home-services": homeServices,
  dental,
  "medical-spa": medicalSpa,
  "wedding-venue": weddingVenue,
  church,
  restaurant,
  "pilates-studio": pilatesStudio,
  "crossfit-gym": crossfitGym,
  other,
};

/** Grid order on screen 1. "Something else" is always last. */
export const TRADE_OPTIONS: { id: TradeId; label: string; hint?: string }[] = [
  { id: "landscaping", label: "Landscaping" },
  { id: "home-services", label: "Home services", hint: "Plumbing, HVAC, electrical" },
  { id: "dental", label: "Dental" },
  { id: "medical-spa", label: "Medical spa" },
  { id: "wedding-venue", label: "Wedding venue" },
  { id: "church", label: "Church" },
  { id: "restaurant", label: "Restaurant" },
  { id: "pilates-studio", label: "Pilates studio" },
  { id: "crossfit-gym", label: "CrossFit gym" },
  { id: "other", label: "Something else" },
];

export const TRADE_IDS: TradeId[] = TRADE_OPTIONS.map((t) => t.id);

export function presetFor(trade: TradeId): TradePreset {
  return PRESETS[trade] ?? PRESETS.other;
}

/** A stored trade string, narrowed back to a TradeId. */
export function asTradeId(value: unknown): TradeId | null {
  if (typeof value !== "string") return null;
  return (TRADE_IDS as string[]).includes(value) ? (value as TradeId) : null;
}

export type { TradeId, TradePreset } from "./types";
