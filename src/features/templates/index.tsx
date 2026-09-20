/**
 * The message templates feature.
 *
 * Owns: the editor at "/settings/templates", the merge renderer, the values
 * that fill it, and the split buttons a contact page mounts for Text and Email.
 *
 * The route sits under "/settings" because that is where the owner goes looking
 * for "the wording I keep reusing", and it is drawn inside the settings frame
 * so the section list stays beside it. The row in that section list belongs to
 * `src/features/settings/lib/sections.ts`, which is another agent's file: until
 * it is added, the screen is reached from the caret on a contact's Text or Email
 * button, and from the command palette.
 *
 * There is no nav item. Templates are not a place the owner works; they are
 * something he sets up once.
 */
import type { FeatureModule } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { TemplatesScreen } from "@/features/templates/screens/TemplatesScreen";

export const feature: FeatureModule = {
  id: "templates",
  routes: [
    // The screen draws its own settings frame (SettingsScreenFrame), which is
    // what carries the section list, so it is registered bare.
    { path: "/settings/templates", element: <TemplatesScreen /> },
  ],
  commands: [
    {
      id: "open-templates",
      label: "Edit message templates",
      group: "Settings",
      keywords: ["text", "email", "canned", "wording", "merge fields"],
      run: () => navigate("/settings/templates"),
    },
  ],
};

export default feature;

export { SendSplitButton } from "@/features/templates/components/SendSplitButton";
