/**
 * "/services": the price list as a first-class page (round 3, criterion 23),
 * reached from the sidebar between Deals and Invoices rather than only from
 * Settings. Every list-building block below - the three charged-once /
 * every-month / every-year groups, the row, the sort - is `ServicesScreen`'s;
 * this file only swaps the frame (`PageHeader` instead of
 * `SettingsScreenFrame` and its section list) and adds the one thing the
 * settings list has never needed: how many live deals use each service, so
 * the owner can tell a service that is safe to retire from one he cannot.
 *
 * "/settings/services" keeps working and keeps drawing `ServicesScreen` -
 * this is a second door onto the same catalog, not a fork of it.
 */
import { useState } from "react";
import { useVocabulary } from "@/app/vocabulary";
import { Button, ConfirmDialog, EmptyState, PageHeader, toast } from "@/ui";
import {
  useDealCounts,
  useDeleteOrDeactivateService,
  useReorderServices,
  useServices,
  useUpdateService,
} from "@/features/catalog/lib/hooks";
import {
  ServiceGroup,
  groupOf,
  sortForDisplay,
} from "@/features/catalog/screens/ServicesScreen";
import { ServiceDialog } from "@/features/catalog/components/ServiceDialog";
import type { Product } from "@/db/repos/products";

export function ServicesPage() {
  const vocabulary = useVocabulary();
  const servicesQuery = useServices();
  const dealCountsQuery = useDealCounts();
  const services = servicesQuery.data ?? [];
  const oneTimeServices = sortForDisplay(services.filter((s) => groupOf(s) === "one_time"));
  const monthlyServices = sortForDisplay(services.filter((s) => groupOf(s) === "month"));
  const yearlyServices = sortForDisplay(services.filter((s) => groupOf(s) === "year"));

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingService, setEditingService] = useState<Product | null>(null);
  const [deletingService, setDeletingService] = useState<Product | null>(null);

  const reorderMutation = useReorderServices();
  const updateMutation = useUpdateService();
  const deleteMutation = useDeleteOrDeactivateService();

  function openCreate() {
    setEditingService(null);
    setEditorOpen(true);
  }

  function openEdit(service: Product) {
    setEditingService(service);
    setEditorOpen(true);
  }

  async function move(service: Product, list: Product[], direction: -1 | 1) {
    const index = list.findIndex((s) => s.id === service.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    try {
      await reorderMutation.mutateAsync(next.map((s) => s.id));
    } catch {
      toast.error("That order did not save.");
    }
  }

  async function toggleActive(service: Product) {
    try {
      await updateMutation.mutateAsync({ id: service.id, patch: { active: !service.active } });
    } catch {
      toast.error(`"${service.name}" did not save.`);
    }
  }

  // One primary button on the screen, and no more (DESIGN.md §5): the header
  // carries it while there is a list, and the empty state carries it while
  // there is not.
  const addServiceButton = (
    <Button variant="primary" data-testid="service-new" onClick={openCreate}>
      Add a service
    </Button>
  );
  const empty = !servicesQuery.isLoading && services.length === 0;

  const groups: { label: string; kind: string; services: Product[] }[] = [
    { label: "Charged once", kind: "one_time", services: oneTimeServices },
    { label: "Every month", kind: "month", services: monthlyServices },
    { label: "Every year", kind: "year", services: yearlyServices },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-6)]" data-testid="services-page">
      <PageHeader
        title="Services"
        subtitle={`What you sell, the price you usually charge, and how many ${vocabulary.lowerMany} use it.`}
        actions={empty ? undefined : addServiceButton}
      />

      {servicesQuery.isLoading ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]" role="status">
          Reading the database.
        </p>
      ) : empty ? (
        <EmptyState
          title="No services yet"
          description={`Add the things you sell so a ${vocabulary.lower} can be priced in two clicks.`}
          action={addServiceButton}
        />
      ) : (
        groups.map((group) => (
          <ServiceGroup
            key={group.kind}
            label={group.label}
            kind={group.kind}
            services={group.services}
            dealCounts={dealCountsQuery.data}
            onMove={(service, list, direction) => void move(service, list, direction)}
            onEdit={openEdit}
            onToggleActive={(service) => void toggleActive(service)}
            onDelete={setDeletingService}
          />
        ))
      )}

      <ServiceDialog open={editorOpen} onOpenChange={setEditorOpen} service={editingService} />

      <ConfirmDialog
        open={Boolean(deletingService)}
        onOpenChange={(open) => {
          if (!open) setDeletingService(null);
        }}
        title="Delete service"
        description={
          deletingService
            ? `Delete "${deletingService.name}"? If a ${vocabulary.lower} already uses it, it is deactivated instead so that ${vocabulary.lower} keeps its price. A deletion can be undone from the toast for the next ten seconds.`
            : undefined
        }
        confirmLabel="Delete service"
        destructive
        onConfirm={async () => {
          const service = deletingService;
          if (!service) return;
          setDeletingService(null);
          try {
            await deleteMutation.mutateAsync(service);
          } catch {
            toast.error(`"${service.name}" could not be deleted.`);
          }
        }}
      />
    </div>
  );
}
