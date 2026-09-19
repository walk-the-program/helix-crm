/**
 * STUB. The AI feature agent replaces this file.
 * Owns: the optional AI module (bring your own key) and its settings.
 * No sidebar item: AI is reached from a record and from Settings.
 */
import type { FeatureModule } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";

function AiScreen() {
  return (
    <div>
      <PageHeader title="AI" subtitle="Optional, off by default, your own key." />
      <EmptyState
        title="The AI module is not built yet"
        description="Paste to record, draft a follow-up and summarise land here."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "ai",
  routes: [{ path: "/ai", element: <AiScreen /> }],
};

export default feature;
