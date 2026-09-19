/**
 * The records feature: contacts, companies, the pipeline, the timeline, tasks,
 * quick add, undo and trash.
 *
 * Routes are fixed by the orchestrator so the other features can link here:
 * /contacts, /contacts/:id, /companies, /companies/:id, /pipeline, /deals/:id,
 * /tasks, plus /trash under Settings in the sidebar.
 *
 * The sidebar labels for the pipeline follow the workspace vocabulary (Deals,
 * Jobs or Quotes). The nav is read once by the shell, so the label is resolved
 * from the settings row at module load and refined by `useVocabulary()` inside
 * the screens.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { Building2, KanbanSquare, ListTodo, Trash2, Users } from "@/ui/icons";
import { ContactsScreen } from "@/features/records/screens/ContactsScreen";
import { ContactPage } from "@/features/records/screens/ContactPage";
import { CompaniesScreen } from "@/features/records/screens/CompaniesScreen";
import { CompanyPage } from "@/features/records/screens/CompanyPage";
import { PipelineScreen } from "@/features/records/screens/PipelineScreen";
import { DealPage } from "@/features/records/screens/DealPage";
import { TasksScreen } from "@/features/records/screens/TasksScreen";
import { TrashScreen } from "@/features/records/screens/TrashScreen";
import { mountQuickAdd } from "@/features/records/quickAdd/host";
import { openQuickAdd } from "@/features/records/quickAdd/store";

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
    { label: "Pipeline", to: "/pipeline", icon: KanbanSquare, order: NAV_ORDER.pipeline },
    { label: "Tasks", to: "/tasks", icon: ListTodo, order: NAV_ORDER.tasks },
    // Under Settings (90) by the orchestrator's instruction.
    { label: "Trash", to: "/trash", icon: Trash2, order: 85 },
  ],

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
      id: "quick-add-task",
      label: "Add a task",
      group: "Records",
      keywords: ["todo", "follow up", "reminder"],
      run: () => openQuickAdd("task"),
    },
  ],

  /** Mount the quick-add dialog once the database is open. Idempotent. */
  onBoot: async () => {
    mountQuickAdd();
  },
};

export default feature;
