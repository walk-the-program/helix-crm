/**
 * The Schedule feature module.
 *
 * Owns: the week at "/schedule", one day at "/schedule/day/:date", the
 * "Schedule a visit" dialog that every other screen opens, and the derived
 * feed underneath all three.
 *
 * Why this exists. A trade owner's week is site visits, estimates and jobs
 * with a date he promised. Helix already knew every one of those dates — a
 * task's due date, a job's expected date, a reminder's next date, an invoice's
 * due date, a billing schedule's next issue — and showed them one record at a
 * time, or on Today for today only. So the week lived in a paper diary or in a
 * calendar app with no link back to the customer, and got typed twice. This
 * module is the one screen that reads all five together.
 *
 * There is no scheduler and no new table (decision PX-6). A visit is a task
 * with a time, a place and a length; the feed derives the week on every read.
 * Nothing runs in the background, which is the same reason Reminders has no
 * `onBoot`: the question "what is on this week" is a query against a date.
 *
 * Sidebar: Schedule sits with Tasks and Reminders, first in that group. They
 * are the three answers to "what do I have to do", and the round-3 rule is
 * that related things are adjacent (src/app/feature.ts, NAV_GROUPS).
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { CalendarBlank } from "@/ui/icons";
import { ScheduleScreen } from "@/features/schedule/screens/ScheduleScreen";
import { ScheduleDayScreen } from "@/features/schedule/screens/ScheduleDayScreen";
import { VisitDialogHost } from "@/features/schedule/components/VisitDialog";
import { openVisitDialog } from "@/features/schedule/lib/visitDialog";

export const feature: FeatureModule = {
  id: "schedule",
  routes: [
    { path: "/schedule", element: <ScheduleScreen /> },
    { path: "/schedule/day/:date", element: <ScheduleDayScreen /> },
  ],
  nav: [
    {
      label: "Schedule",
      to: "/schedule",
      icon: CalendarBlank,
      order: NAV_ORDER.schedule,
    },
  ],
  commands: [
    {
      id: "open-schedule",
      label: "Open schedule",
      group: "Find",
      keywords: ["calendar", "week", "diary", "appointments", "visits", "agenda"],
      run: () => navigate("/schedule"),
    },
    {
      id: "schedule-visit",
      label: "Schedule a visit",
      group: "Create",
      keywords: ["appointment", "calendar", "visit", "estimate", "site visit", "book"],
      run: () => openVisitDialog(),
    },
  ],
  /**
   * The visit dialog, on every screen. The Schedule's empty states, a task
   * row's "Edit time and place" and the palette all open this one mounted
   * form rather than each carrying a copy of it.
   */
  overlays: () => <VisitDialogHost />,
};

export default feature;

export { openVisitDialog } from "@/features/schedule/lib/visitDialog";
export type { ScheduleItem } from "@/features/schedule/lib/types";
