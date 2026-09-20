/**
 * The recurring reminders feature.
 *
 * Owns: the Reminders screen at "/recurring", the "Remind me every..." panel a
 * record page mounts, the rule dialog, and the data layer for all three.
 * Today's "Coming up" section lives with Today's other sections and reads this
 * feature's hooks.
 *
 * There is no `onBoot`. A rule is a row with a date on it and the question
 * "what is due" is a query against today, so nothing has to be running for the
 * product to be right - which is the whole reason this is not a scheduler.
 *
 * Sidebar order 55 puts Reminders between Tasks (50) and Reports (60): it is
 * the same kind of thing as a task list, and it belongs beside it.
 */
import type { FeatureModule } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { ArrowsClockwise } from "@/ui/icons";
import { RecurringScreen } from "@/features/recurring/screens/RecurringScreen";

export const feature: FeatureModule = {
  id: "recurring",
  routes: [{ path: "/recurring", element: <RecurringScreen /> }],
  nav: [{ label: "Reminders", to: "/recurring", icon: ArrowsClockwise, order: 55 }],
  commands: [
    {
      id: "open-reminders",
      label: "Open reminders",
      group: "Find",
      keywords: ["recurring", "every year", "seasonal", "service", "maintenance"],
      run: () => navigate("/recurring"),
    },
  ],
};

export default feature;

export { RecurringPanel } from "@/features/recurring/components/RecurringPanel";
export { RuleDialog } from "@/features/recurring/components/RuleDialog";
