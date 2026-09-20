/**
 * The service catalog feature.
 *
 * Owns: the price list at "/settings/services" (the `products` table) and
 * the query hooks a deal's line-item editor will read it through. A deal
 * line item copies a product's name and price at the moment it is added, so
 * this feature is the one place that price is decided; everywhere else just
 * quotes it.
 *
 * The route sits under "/settings" because a price list is set up once, not
 * a place the owner works day to day - the same reasoning `templates` uses
 * for "/settings/templates". It is drawn inside the settings frame so the
 * section list stays beside it, and the row for it in that section list
 * belongs to `src/features/settings/lib/sections.ts`, another agent's file,
 * marked `external: true` there because this feature is the one that
 * registers the route.
 *
 * There is no nav item, for the same reason templates has none: a price
 * list is not a place the owner works, it is something he sets up once and
 * a deal reads from afterward.
 *
 * Other routes land in this same module later (the deal page, the revenue
 * report) - keep each addition to its own route/command entry rather than
 * growing this file's exports.
 */
import type { FeatureModule } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { ServicesScreen } from "@/features/catalog/screens/ServicesScreen";

export const feature: FeatureModule = {
  id: "catalog",
  routes: [
    // The screen draws its own settings frame (SettingsNav + the column
    // cap), which is what carries the section list, so it is registered
    // bare, the same way templates registers TemplatesScreen.
    { path: "/settings/services", element: <ServicesScreen /> },
  ],
  commands: [
    {
      id: "open-services",
      label: "Edit your services",
      group: "Settings",
      keywords: ["price", "prices", "catalog", "rates", "what I sell"],
      run: () => navigate("/settings/services"),
    },
  ],
};

export default feature;
