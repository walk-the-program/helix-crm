/**
 * The service catalog feature.
 *
 * Owns: the price list, now a first-class page at "/services" as well as
 * "/settings/services" (both read the `products` table through the same
 * screen), and the query hooks a deal's line-item editor reads it through. A
 * deal line item copies a product's name and price at the moment it is
 * added, so this feature is the one place that price is decided; everywhere
 * else just quotes it.
 *
 * "/settings/services" stays live and points at the same screen (round 3,
 * criterion 23: "the Settings > Services row links there") - the settings
 * row in `src/features/settings/lib/sections.ts` is unchanged, another
 * agent's file. "/services" is the new day-to-day entry, drawn without the
 * settings frame, with its own sidebar row between Deals and Invoices.
 *
 * NAV_ORDER (src/app/feature.ts, owned by R3-L1) does not have a `services`
 * entry yet, so the row below uses the literal 45 - between `pipeline` (40)
 * and `tasks` (50), which is where Deals/Invoices land per the round's
 * sidebar grouping. Swap this for `NAV_ORDER.services` once R3-L1 adds it.
 *
 * Other routes land in this same module later (the revenue report reading
 * `products.search`) - keep each addition to its own route/command entry
 * rather than growing this file's exports.
 */
import type { FeatureModule } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { Box } from "@/ui/icons";
import { ServicesScreen } from "@/features/catalog/screens/ServicesScreen";
import { ServicesPage } from "@/features/catalog/screens/ServicesPage";

export const feature: FeatureModule = {
  id: "catalog",
  routes: [
    // The first-class page: its own frame (PageHeader, no settings nav).
    { path: "/services", element: <ServicesPage /> },
    // The screen draws its own settings frame (SettingsNav + the column
    // cap), which is what carries the section list, so it is registered
    // bare, the same way templates registers TemplatesScreen.
    { path: "/settings/services", element: <ServicesScreen /> },
  ],
  nav: [
    // TODO(R3-L1): NAV_ORDER.services - literal 45 until the shared
    // constant exists, between Deals (pipeline, 40) and Invoices/Tasks (50).
    { label: "Services", to: "/services", icon: Box, order: 45 },
  ],
  commands: [
    {
      id: "open-services",
      label: "Edit your services",
      group: "Settings",
      keywords: ["price", "prices", "catalog", "rates", "what I sell"],
      run: () => navigate("/services"),
    },
  ],
};

export default feature;

export { NewServiceDialog } from "@/features/catalog/components/NewServiceDialog";
