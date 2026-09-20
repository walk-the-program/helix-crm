/**
 * The ten sample sets, one per trade on the grid.
 *
 * "Something else" gets a generic service-business set, because an owner who
 * picked it still deserves to see Today with rows on it.
 */
import type { TradeId } from "../presets/types";
import type { SampleSet } from "./types";
import { sample as landscaping } from "./landscaping";
import { sample as homeServices } from "./home-services";
import { sample as dental } from "./dental";
import { sample as medicalSpa } from "./medical-spa";
import { sample as weddingVenue } from "./wedding-venue";
import { sample as church } from "./church";
import { sample as restaurant } from "./restaurant";
import { sample as pilatesStudio } from "./pilates-studio";
import { sample as crossfitGym } from "./crossfit-gym";
import { sample as other } from "./other";

export const SAMPLES: Record<TradeId, SampleSet> = {
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

export function sampleFor(trade: TradeId): SampleSet {
  return SAMPLES[trade] ?? SAMPLES.other;
}

export { SAMPLE_TAG } from "./types";
export type { SampleSet } from "./types";
