/**
 * The records feature: contacts, companies, the pipeline, the timeline, tasks,
 * quick add, undo and trash.
 *
 * Routes are fixed by the orchestrator so the other features can link here:
 * /contacts, /contacts/:id, /companies, /companies/:id, /pipeline, /deals/:id,
 * /tasks, plus /trash under Settings in the sidebar.
 *
 * The sidebar row for the pipeline follows the workspace vocabulary: after
 * setup for a landscaping business it reads Jobs, for a dental practice Quotes.
 * `nav` is a static array the shell flattens once, before the database is open,
 * so it cannot carry that label; the row is contributed through `navProvider`
 * instead, which the shell calls on every render and which may therefore use
 * `useVocabulary()`. The group it returns is deliberately UNLABELLED, so the
 * shell merges the row into the run of static rows around it and the sidebar
 * keeps the grouping it always had. The route stays "/pipeline".
 */
import type { FeatureModule, FeatureNavSection } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { useVocabulary } from "@/app/vocabulary";
import { Building2, KanbanSquare, ListTodo, Trash2, Users } from "@/ui/icons";
import { ContactsScreen } from "@/features/records/screens/ContactsScreen";
import { ContactPage } from "@/features/records/screens/ContactPage";
import { CompaniesScreen } from "@/features/records/screens/CompaniesScreen";
import { CompanyPage } from "@/features/records/screens/CompanyPage";
import { PipelineScreen } from "@/features/records/screens/PipelineScreen";
import { DealPage } from "@/features/records/screens/DealPage";
import { TasksScreen } from "@/features/records/screens/TasksScreen";
import { TrashScreen } from "@/features/records/screens/TrashScreen";
import { QuickAddDialog } from "@/features/records/quickAdd/QuickAddDialog";
import { openQuickAdd } from "@/features/records/quickAdd/store";

/**
 * The pipeline row, named whatever this workspace calls the work.
 *
 * One unlabelled group holding one row. `useVocabulary()` falls back to Deals
 * while the settings row is in flight, so the sidebar never renders a blank row
 * and never flashes an empty group.
 */
function usePipelineNav(): FeatureNavSection[] {
  const vocabulary = useVocabulary();
  return [
    {
      order: NAV_ORDER.pipeline,
      items: [
        {
          label: vocabulary.many,
          to: "/pipeline",
          icon: KanbanSquare,
          order: NAV_ORDER.pipeline,
        },
      ],
    },
  ];
}

export const feature: FeatureModule = {
  id: "records",

  routes: [
    { path: "/contacts", element: <ContactsScreen /> },
    { path: "/contacts/:id", element: <ContactPage /> },
    { path: "/companies", element: <CompaniesScreen /> },
    { path: "/companies/:id", element: <CompanyPage /> },
    { path: "/pipeline", element: <PipelineScreen /> },
    { path: "/deals/:id", element: <DealPage /> },
    { path: "/tasks", element: <TasksScreen /> },
    { path: "/trash", element: <TrashScreen /> },
  ],

  nav: [
    { label: "Contacts", to: "/contacts", icon: Users, order: NAV_ORDER.contacts },
    { label: "Companies", to: "/companies", icon: Building2, order: NAV_ORDER.companies },
    { label: "Tasks", to: "/tasks", icon: ListTodo, order: NAV_ORDER.tasks },
    // Under Settings (90) by the orchestrator's instruction.
    { label: "Trash", to: "/trash", icon: Trash2, order: 85 },
  ],

  /** The pipeline row, whose label is Deals, Jobs or Quotes. */
  navProvider: usePipelineNav,

  commands: [
    {
      id: "quick-add",
      label: "Quick add",
      shortcut: "mod+n",
      group: "Records",
      keywords: ["new", "contact", "company", "deal", "job", "quote", "task", "note"],
      run: () => openQuickAdd(),
    },
    {
      // The macOS File menu's "New deal". Quick add already opens on any tab;
      // this is the id the menu item carries (src-tauri/src/menu.rs), and it
      // earns its place in the palette too.
      id: "new-deal",
      label: "New deal",
      group: "Records",
      keywords: ["job", "quote", "opportunity", "work"],
      run: () => openQuickAdd("deal"),
    },
    {
      id: "quick-add-task",
      label: "Add a task",
      group: "Records",
      keywords: ["todo", "follow up", "reminder"],
      run: () => openQuickAdd("task"),
    },
  ],

  /**
   * Quick add has to work from every screen. It used to reach one by mounting a
   * second React root on <body> from `onBoot`, with its own copy of the
   * providers and its own mod+n listener; the shell's `overlays` slot renders it
   * inside the app's providers instead, and the shell binds mod+n from the
   * "quick-add" command above.
   */
  overlays: () => <QuickAddDialog />,
};

export default feature;
