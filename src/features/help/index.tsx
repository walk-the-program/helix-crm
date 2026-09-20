/**
 * The Help feature.
 *
 * Owns: the one reading screen at "/help" and its copy (lib/content.ts). It
 * does not own the shortcuts sheet or the Diagnostics screen — those belong to
 * settings, and Help only ever reaches them through the registry
 * (`findCommand`) or a plain route, never through a direct import out of
 * src/features/settings.
 *
 * The "open-help" command carries no `shortcut`. "?" already belongs to the
 * settings feature's "show-shortcuts" command (src/features/settings/index.tsx),
 * and a second command claiming the same bare key would be a bug the shell
 * has no way to catch for us — see FeatureCommand.shortcut in src/app/feature.ts.
 */
import { navigate } from "wouter/use-browser-location";
import type { FeatureModule } from "@/app/feature";
import { Info } from "@/ui/icons";
import { HelpScreen } from "@/features/help/screens/HelpScreen";

/**
 * The one thing another feature is meant to import from here directly: a
 * link to a named Help section, for the empty states and failure banners
 * that need to point somewhere more specific than "/help" (LR-CS-W3).
 */
export { HelpLink } from "@/features/help/components/HelpLink";

export const feature: FeatureModule = {
  id: "help",
  routes: [{ path: "/help", element: <HelpScreen /> }],
  nav: [{ label: "Help", to: "/help", icon: Info, order: 95 }],
  commands: [
    {
      id: "open-help",
      label: "Open help",
      group: "Help",
      keywords: ["support", "docs", "guide", "faq", "question"],
      run: () => navigate("/help"),
    },
  ],
};

export default feature;
