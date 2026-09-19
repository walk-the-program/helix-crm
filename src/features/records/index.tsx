/**
 * STUB. The records feature agent replaces this file.
 * Owns: contacts, companies, deals, pipeline, timeline, tasks, quick add,
 * undo, trash.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";
import { Building2, KanbanSquare, ListTodo, Users } from "lucide-react";

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState
        title={`${title} is not built yet`}
        description="The records feature agent fills this in."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "records",
  routes: [
    { path: "/contacts", element: <Placeholder title="Contacts" /> },
    { path: "/companies", element: <Placeholder title="Companies" /> },
    { path: "/pipeline", element: <Placeholder title="Pipeline" /> },
    { path: "/tasks", element: <Placeholder title="Tasks" /> },
  ],
  nav: [
    { label: "Contacts", to: "/contacts", icon: Users, order: NAV_ORDER.contacts },
    { label: "Companies", to: "/companies", icon: Building2, order: NAV_ORDER.companies },
    { label: "Pipeline", to: "/pipeline", icon: KanbanSquare, order: NAV_ORDER.pipeline },
    { label: "Tasks", to: "/tasks", icon: ListTodo, order: NAV_ORDER.tasks },
  ],
};

export default feature;
