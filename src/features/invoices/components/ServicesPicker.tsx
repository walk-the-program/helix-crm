/**
 * "Add a line": tick the services this line item is for, several at once,
 * search retyped without losing what is already ticked.
 *
 * Walker's own framing was "just select which one it is from a list (or
 * multiple ones)", which is why the selection lives in a `Map` keyed by
 * product id rather than a list of the currently visible rows - the owner
 * searches "mulch", ticks it, searches "edging", ticks that too, and both
 * have to survive the second search replacing the first search's results.
 * Each entry also keeps the row's catalog `position`, purely so `onAdd` can
 * hand the lines back in catalog order regardless of the order they were
 * ticked in - the contract's own requirement.
 *
 * "New service..." opens the catalog's own `NewServiceDialog` on top of this
 * one rather than replacing it, so Escape from the small form comes back to a
 * still-open picker; only a successful save closes both, because that save
 * already finished the job the picker was open for. The dialog belongs to the
 * catalog feature, not to this one - the deal page's services panel opens the
 * same form, and a service created from an invoice line has to be the same
 * catalog row either way.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Spinner,
} from "@/ui";
import * as products from "@/db/repos/products";
import type { Product } from "@/db/repos/products";
import { useFormats } from "@/app/formats";
import { intervalLabel } from "@/features/invoices/lib/format";
import { productToPickedService } from "@/features/invoices/lib/newService";
import type { PickedService } from "@/features/invoices/lib/newService";
import { NewServiceDialog } from "@/features/catalog";

/** One line the picker hands back, in the shape the line editor stores. */
export type { PickedService };

type SelectedEntry = { position: number; service: PickedService };

/**
 * A local key namespace rather than this feature's shared `iqk` (in
 * lib/hooks.ts, which this component does not own): the picker's own search
 * results are not read anywhere else, so they do not need a place in the
 * feature's shared invalidation list.
 */
const SERVICES_QUERY_NAMESPACE = ["invoices", "services"] as const;

export function ServicesPicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everything ticked, in catalog order. Never called with an empty array. */
  onAdd: (services: PickedService[]) => void;
  /** The owner wants one blank line to type himself. */
  onCustomLine: () => void;
}) {
  const { open, onOpenChange, onAdd, onCustomLine } = props;
  const queryClient = useQueryClient();
  // A price list in the wrong currency is worse than no price list.
  const formats = useFormats();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<string, SelectedEntry>>(new Map());
  const [newServiceOpen, setNewServiceOpen] = useState(false);

  // Reopening on a different document must not carry over the last one's
  // search or ticks, so both reset on open rather than on close.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(new Map());
  }, [open]);

  const trimmedSearch = search.trim();
  const query = useQuery({
    queryKey: [...SERVICES_QUERY_NAMESPACE, trimmedSearch],
    queryFn: () => products.list({ activeOnly: true, search: trimmedSearch }),
    enabled: open,
  });

  const rows = query.data?.rows ?? [];
  const catalogEmpty = !query.isLoading && rows.length === 0 && trimmedSearch.length === 0;
  const noMatches = !query.isLoading && rows.length === 0 && trimmedSearch.length > 0;

  function toggle(product: Product, checked: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(product.id, { position: product.position, service: productToPickedService(product) });
      } else {
        next.delete(product.id);
      }
      return next;
    });
  }

  function confirmAdd() {
    const chosen = Array.from(selected.values())
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.service);
    if (chosen.length === 0) return;
    onAdd(chosen);
    onOpenChange(false);
  }

  function handleCustomLine() {
    onCustomLine();
    onOpenChange(false);
  }

  const count = selected.size;
  // "Add 0 services" is not a sentence anyone writes. Nothing ticked yet means
  // the button is disabled and says what it is for, not how many of nothing.
  const addLabel =
    count === 0 ? "Add services" : count === 1 ? "Add 1 service" : `Add ${count} services`;
  const newServiceAction = (
    <Button variant="secondary" onClick={() => setNewServiceOpen(true)}>
      New service...
    </Button>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" data-testid="services-picker">
          <DialogHeader>
            <DialogTitle>Add a line</DialogTitle>
            <DialogDescription>Pick from what you sell, or start from scratch.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-[var(--space-4)]">
            <Input
              search
              aria-label="Search your services"
              data-testid="services-picker-search"
              placeholder="Search your services"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="flex max-h-[320px] flex-col overflow-y-auto">
              {query.isLoading ? (
                <div className="flex items-center justify-center py-[var(--space-6)]">
                  <Spinner label="Reading your services" />
                </div>
              ) : catalogEmpty ? (
                <EmptyState
                  title="No services yet"
                  description="Add what you sell so it is one tick away next time."
                  action={newServiceAction}
                />
              ) : noMatches ? (
                <EmptyState
                  title="Nothing by that name"
                  description={`No service matches "${trimmedSearch}".`}
                  action={newServiceAction}
                />
              ) : (
                rows.map((product) => {
                  const checked = selected.has(product.id);
                  return (
                    <label
                      key={product.id}
                      className="flex cursor-pointer items-center gap-[var(--space-3)] border-b border-[var(--color-border)] py-[var(--space-2)] last:border-b-0 hover:bg-[var(--color-hover)]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => toggle(product, next)}
                        ariaLabel={product.name}
                      />
                      <span className="flex-1 truncate text-[length:var(--text-base)] text-[var(--color-text)]">
                        {product.name}
                      </span>
                      <span className="flex-none whitespace-nowrap text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        {formats.money(product.unitPriceCents)}
                        {product.kind === "recurring"
                          ? ` ${intervalLabel(product.kind, product.interval)}`
                          : ""}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {!catalogEmpty && !noMatches ? (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setNewServiceOpen(true)}>
                  New service...
                </Button>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleCustomLine}>
              Custom line
            </Button>
            <Button variant="primary" disabled={count === 0} onClick={confirmAdd}>
              {addLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewServiceDialog
        open={newServiceOpen}
        onOpenChange={setNewServiceOpen}
        initialName={trimmedSearch}
        onCreated={(product) => {
          // The catalog hands back its saved row; `productToPickedService` is
          // the one place that turns a catalog row into a line, so the picker
          // and the quick form cannot disagree about the price.
          void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_NAMESPACE });
          setNewServiceOpen(false);
          onAdd([productToPickedService(product)]);
          onOpenChange(false);
        }}
      />
    </>
  );
}
