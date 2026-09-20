/**
 * Settings > Services: the price list a deal's line items are built from.
 *
 * Three grouped inset lists - charged once, every month, every year - which
 * are the same three answers the dialog asks for, so a row can never
 * contradict the label above it. The shape is `TemplatesScreen`'s: the
 * reference for this exact kind of settings-owned, reorderable,
 * create/edit/delete list. Reorder is buttons that move a row up and down rather than
 * drag-and-drop, because `TemplatesScreen` does it that way and a catalog is
 * no longer a list than a set of templates.
 *
 * Within a group, active services sort first in `position` order and
 * inactive ones trail behind in their own `position` order, quieter in ink.
 * Move up/down (and `productsRepo.reorder`, which only rewrites the ids it is
 * given, exactly like `templatesRepo.reorder`) operate on that displayed
 * order, which is what keeps "inactive always last" true after every move
 * rather than just on first paint.
 *
 * Delete asks once, up front, in words that are true either way it turns
 * out: `productsRepo.removeOrDeactivate` decides only after the confirm,
 * and the toast that follows says which one happened.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { useVocabulary, type Vocabulary } from "@/app/vocabulary";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  toast,
} from "@/ui";
import { CaretDown, ICON_SIZE_SM, ICON_WEIGHT_STRONG } from "@/ui/icons";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsScreenFrame,
} from "@/features/settings/components/SettingsLayout";
import { formatMoneyTrim } from "@/lib/money";
import {
  useDeleteOrDeactivateService,
  useReorderServices,
  useServices,
  useUpdateService,
} from "@/features/catalog/lib/hooks";
import { ServiceDialog } from "@/features/catalog/components/ServiceDialog";
import type { Product } from "@/db/repos/products";

/**
 * Active first (each in `position` order), inactive trailing (also in
 * `position` order) - the sort the whole screen treats as canonical.
 *
 * Exported so `ServicesPage` (the "/services" first-class page, round 3
 * criterion 23) draws the identical order rather than inventing its own.
 */
export function sortForDisplay(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.position - b.position;
  });
}

/**
 * "$150", "$150/mo", "$1,200/yr".
 *
 * `formatMoneyTrim` rather than `formatMoney`: a price list is written in
 * round numbers, and ".00" on every row is noise the owner reads past. It is
 * the same formatter the deal page's breakdown uses, so a service costs the
 * same number of characters wherever it is quoted.
 */
export function priceLabel(service: Product): string {
  const amount = formatMoneyTrim(service.unitPriceCents);
  if (service.kind === "one_time") return amount;
  return service.interval === "year" ? `${amount}/yr` : `${amount}/mo`;
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "3 jobs", "1 job", "No jobs" - in the workspace's own word, which is the
 * whole point of the vocabulary setting: a landscaping setup says jobs
 * everywhere else and this row was the last place still saying deals.
 *
 * Always shown, even at zero, because zero is the number that tells the owner
 * a service is safe to delete outright rather than only deactivate.
 */
function dealCountLabel(count: number, vocabulary: Vocabulary): string {
  if (count === 0) return `No ${vocabulary.lowerMany}`;
  return count === 1 ? `1 ${vocabulary.lower}` : `${count} ${vocabulary.lowerMany}`;
}

export function ServiceRow(props: {
  service: Product;
  isFirst: boolean;
  isLast: boolean;
  /** Live deals using this service. Omitted on the settings list, which has
   *  never shown it and stays focused on editing rather than reporting. */
  dealCount?: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const {
    service,
    isFirst,
    isLast,
    dealCount,
    onMoveUp,
    onMoveDown,
    onEdit,
    onToggleActive,
    onDelete,
  } = props;
  const vocabulary = useVocabulary();
  const quiet = !service.active;

  return (
    <div
      className="flex min-h-[var(--row-h)] items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-2)] last:border-b-0"
      data-testid="service-row"
      data-service-name={service.name}
    >
      <span className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]">
        <span
          className={
            quiet
              ? "truncate text-[length:var(--text-base)] text-[var(--color-text-muted)]"
              : "truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          }
          title={service.name}
        >
          {service.name}
        </span>
        {service.taxable ? <Badge tone="neutral">Taxable</Badge> : null}
        {quiet ? <Badge tone="neutral">Inactive</Badge> : null}
      </span>

      <span
        className={
          quiet
            ? "money flex-none whitespace-nowrap text-[length:var(--text-base)] text-[var(--color-text-muted)]"
            : "money flex-none whitespace-nowrap text-[length:var(--text-base)] text-[var(--color-text)]"
        }
      >
        {priceLabel(service)}
      </span>

      {dealCount !== undefined ? (
        <span
          data-testid="service-deal-count"
          className="money flex-none whitespace-nowrap text-[length:var(--text-sm)] text-[var(--color-text-faint)]"
        >
          {dealCountLabel(dealCount, vocabulary)}
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={`Actions for "${service.name}"`}
            size="sm"
            data-testid="service-row-menu"
          >
            <CaretDown size={ICON_SIZE_SM} weight={ICON_WEIGHT_STRONG} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={onMoveUp}>
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={onMoveDown}>
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleActive}>
            {service.active ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Group (one kind)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The group a service belongs in, which is the same three answers the dialog
 * asks for. Two groups would file a yearly plan under "every month", and a
 * section label the rows contradict is worse than no label.
 */
export function groupOf(service: Product): "one_time" | "month" | "year" {
  if (service.kind === "one_time") return "one_time";
  return service.interval === "year" ? "year" : "month";
}

export function ServiceGroup(props: {
  label: string;
  kind: string;
  services: Product[];
  dealCounts?: Map<string, number>;
  onMove: (service: Product, list: Product[], direction: -1 | 1) => void;
  onEdit: (service: Product) => void;
  onToggleActive: (service: Product) => void;
  onDelete: (service: Product) => void;
}): ReactElement | null {
  const { label, kind, services, dealCounts, onMove, onEdit, onToggleActive, onDelete } = props;
  if (services.length === 0) return null;

  return (
    <SettingsGroup label={label} data-testid={`services-group-${kind}`}>
      {services.map((service, index) => (
        <ServiceRow
          key={service.id}
          service={service}
          isFirst={index === 0}
          isLast={index === services.length - 1}
          dealCount={dealCounts?.get(service.id) ?? (dealCounts ? 0 : undefined)}
          onMoveUp={() => onMove(service, services, -1)}
          onMoveDown={() => onMove(service, services, 1)}
          onEdit={() => onEdit(service)}
          onToggleActive={() => onToggleActive(service)}
          onDelete={() => onDelete(service)}
        />
      ))}
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function ServicesScreen() {
  const vocabulary = useVocabulary();
  const servicesQuery = useServices();
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
  // there is not. Rendering both at once is the bug that rule names.
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
    <SettingsScreenFrame
      title="Services"
      subtitle="What you sell, and the price you usually charge."
      testId="services-screen"
      actions={empty ? undefined : addServiceButton}
    >
      {servicesQuery.isLoading ? (
        <SettingsLoading>Reading the database.</SettingsLoading>
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
    </SettingsScreenFrame>
  );
}
