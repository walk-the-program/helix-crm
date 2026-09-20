/**
 * What a deal is for, priced (D20).
 *
 * The panel exists because one number on a deal hides the thing the owner
 * actually wants to know: a $3,300 deal is either a patio he builds once or a
 * maintenance contract that pays every month, and those are not the same
 * business. So every line carries its own kind, and the totals are always
 * written as the breakdown.
 *
 * Two prices per line, and both are on screen. The suggested price is what the
 * services catalog says and is read-only; the actual price is what he is
 * charging and is the only editable one. The difference between the two totals
 * is printed under them, because a discount he cannot see is a discount he
 * repeats.
 *
 * The panel never computes the deal's value itself. `dealItems.recompute`
 * writes it in the same transaction as the line change, and the panel reads
 * the totals back from the same lines it is drawing, so what is on screen and
 * what is in the database are the same arithmetic.
 *
 * Colour: none. The deal page already spends its one primary block on the
 * value beside the title, so everything here is neutral ink, hairlines and one
 * secondary button.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Trash, X } from "@/ui/icons";
import { Button, Card, CardGroupLabel, IconButton, Input, Select, toast } from "@/ui";
import { MultiCombobox, type ComboboxItem } from "@/ui/Combobox";
import * as dealItemsRepo from "@/db/repos/dealItems";
import { totalsFor, type DealItem } from "@/db/repos/dealItems";
import * as productsRepo from "@/db/repos/products";
import type { Product } from "@/db/repos/products";
import {
  centsToDecimalString,
  formatBreakdown,
  formatMoneyTrim,
  parseMoneyToCents,
} from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import { invalidateDealMoney, useDealItems } from "@/features/catalog/lib/dealItemHooks";
import { CUSTOM_LINE_ID, diffServiceSelection } from "@/features/catalog/lib/servicePicker";
import { NewServiceDialog } from "@/features/catalog/components/NewServiceDialog";

/** "one-time", "per month", "per year" - the words the owner uses. */
export function chargeLabel(
  kind: dealItemsRepo.ItemKind,
  interval: dealItemsRepo.ItemInterval | null,
): string {
  if (kind !== "recurring") return "one-time";
  return interval === "year" ? "per year" : "per month";
}

function report(err: unknown, fallback: string): void {
  toast.error(err instanceof Error && err.message.trim().length > 0 ? err.message : fallback);
}

/* -------------------------------------------------------------------------- */
/* the add picker                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The catalog search, as `ComboboxItem`s, with "Custom line" pinned to the
 * top of every result set - it is not a catalog row, so it cannot come back
 * from `products.search` on its own, and the owner needs it whether or not
 * anything he has typed matches a real service.
 */
async function searchServiceItems(query: string): Promise<ComboboxItem[]> {
  const results = await productsRepo.search(query);
  const items: ComboboxItem[] = results.map((result) => ({
    id: result.id,
    label: result.label,
    detail: `${formatMoneyTrim(result.unitPriceCents)} · ${chargeLabel(result.kind, result.interval)}`,
  }));
  return [{ id: CUSTOM_LINE_ID, label: "Custom line" }, ...items];
}

/**
 * The panel's one action. `values` is the deal's own line-item product ids,
 * so a tick always means "on this deal" and survives a reopen honestly - see
 * `diffServiceSelection`. Picking several in one session adds each in turn;
 * unticking one removes its line the same way the trash icon on the row does.
 *
 * "New service..." opens the quick form (`NewServiceDialog`) with whatever
 * was typed as the starting name; a successful save both writes the catalog
 * row and adds it as a line, in one motion.
 */
function AddServicesControl(props: {
  dealId: string;
  lines: DealItem[];
  onCustom: () => void;
  onNewService: (initialName: string) => void;
}) {
  const { dealId, lines, onCustom, onNewService } = props;

  const productIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const line of lines) {
      if (line.productId && !seen.has(line.productId)) {
        seen.add(line.productId);
        ids.push(line.productId);
      }
    }
    return ids;
  }, [lines]);

  const lineByProductId = useMemo(() => {
    const map = new Map<string, DealItem>();
    for (const line of lines) {
      if (line.productId && !map.has(line.productId)) map.set(line.productId, line);
    }
    return map;
  }, [lines]);

  async function handleChange(nextIdsRaw: string[]) {
    const { added, removed, customLineRequested } = diffServiceSelection(
      productIds,
      nextIdsRaw,
    );
    if (customLineRequested) onCustom();

    for (const productId of added) {
      try {
        await dealItemsRepo.addFromProduct(dealId, productId);
      } catch (err) {
        report(err, "That service was not added.");
      }
    }
    for (const productId of removed) {
      const line = lineByProductId.get(productId);
      if (!line) continue;
      try {
        await dealItemsRepo.remove(line.id);
      } catch (err) {
        report(err, "That service was not removed.");
      }
    }
    if (added.length > 0 || removed.length > 0) await invalidateDealMoney();
  }

  return (
    <MultiCombobox
      values={productIds}
      onChange={(ids) => void handleChange(ids)}
      items={searchServiceItems}
      placeholder="Add services"
      summaryLabel={() => "Add services"}
      emptyText="No services match. Pick New service to add one."
      onCreate={(query) => onNewService(query)}
      createLabel={() => "New service…"}
      aria-label="Add services"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* the custom line row                                                        */
/* -------------------------------------------------------------------------- */

const CHARGE_OPTIONS = [
  { value: "one_time", label: "One time" },
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
];

function CustomLineRow(props: { dealId: string; onDone: () => void }) {
  const { dealId, onDone } = props;
  const [name, setName] = useState("");
  const [charge, setCharge] = useState("one_time");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const cents = parseMoneyToCents(price);
    if (name.trim().length === 0) {
      setError("Give the line a name.");
      return;
    }
    if (cents === null) {
      setError("Enter an amount, for example 150.");
      return;
    }
    try {
      await dealItemsRepo.add({
        dealId,
        name,
        kind: charge === "one_time" ? "one_time" : "recurring",
        interval: charge === "one_time" ? null : (charge as "month" | "year"),
        suggestedUnitCents: cents,
      });
      await invalidateDealMoney();
      onDone();
    } catch (err) {
      report(err, "That line was not added.");
    }
  }

  return (
    <div
      data-testid="custom-line-row"
      className="flex flex-wrap items-start gap-[var(--space-2)] border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-3)]"
    >
      <div className="min-w-[160px] flex-1">
        <Input
          autoFocus
          value={name}
          placeholder="What is it?"
          aria-label="Line name"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="w-[140px]">
        <Select
          ariaLabel="How is it charged?"
          value={charge}
          options={CHARGE_OPTIONS}
          onValueChange={setCharge}
        />
      </div>
      <div className="w-[110px]">
        <Input
          value={price}
          className="money text-right"
          placeholder="150"
          aria-label="Price"
          onChange={(event) => setPrice(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </div>
      <IconButton
        label="Save line"
        onClick={() => void save()}
        icon={<Check size={16} weight="bold" aria-hidden="true" />}
      />
      <IconButton
        label="Cancel"
        onClick={onDone}
        icon={<X size={16} weight="bold" aria-hidden="true" />}
      />
      {error ? (
        <p className="w-full text-[length:var(--text-xs)] text-[var(--color-danger-ink)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* one line                                                                   */
/* -------------------------------------------------------------------------- */

function ServiceRow(props: { item: DealItem; currency: string }) {
  const { item, currency } = props;
  const [price, setPrice] = useState(centsToDecimalString(item.actualUnitCents));
  const [qty, setQty] = useState(String(item.qty));

  /*
   * Redraw both fields from the row whenever the row changes underneath them.
   *
   * Without this the field keeps whatever was typed into it - "1200" beside
   * the next line's "150.00" - so two prices that are both saved and both
   * correct are written two different ways on the same panel. The guard
   * matters: rewriting on every render would fight the owner's cursor
   * mid-word, so the input is only reset when the saved value it is showing
   * is genuinely a different number.
   */
  useEffect(() => {
    setPrice(centsToDecimalString(item.actualUnitCents));
  }, [item.id, item.actualUnitCents]);

  useEffect(() => {
    setQty(String(item.qty));
  }, [item.id, item.qty]);

  async function savePrice() {
    const cents = parseMoneyToCents(price);
    if (cents === null || cents === item.actualUnitCents) {
      setPrice(centsToDecimalString(item.actualUnitCents));
      return;
    }
    try {
      await dealItemsRepo.update(item.id, { actualUnitCents: cents });
      setPrice(centsToDecimalString(cents));
      await invalidateDealMoney();
    } catch (err) {
      setPrice(centsToDecimalString(item.actualUnitCents));
      report(err, "That price did not save.");
    }
  }

  async function saveQty() {
    const next = Number.parseInt(qty, 10);
    if (!Number.isFinite(next) || next < 1 || next === item.qty) {
      setQty(String(item.qty));
      return;
    }
    try {
      await dealItemsRepo.update(item.id, { qty: next });
      await invalidateDealMoney();
    } catch (err) {
      setQty(String(item.qty));
      report(err, "That quantity did not save.");
    }
  }

  async function removeLine() {
    try {
      await dealItemsRepo.remove(item.id);
      await invalidateDealMoney();
      toast.success(`Removed ${item.name}.`);
    } catch (err) {
      report(err, "That line was not removed.");
    }
  }

  return (
    <div
      data-testid="deal-service-row"
      data-item-id={item.id}
      className="flex flex-wrap items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-2)] last:border-b-0"
    >
      <div className="min-w-[140px] flex-1">
        <div
          className="truncate text-[length:var(--text-base)] text-[var(--color-text)]"
          title={item.name}
        >
          {item.name}
        </div>
        <div className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {chargeLabel(item.kind, item.interval)}
        </div>
      </div>

      <label className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
        <span>Qty</span>
        <Input
          value={qty}
          inputMode="numeric"
          aria-label={`Quantity for ${item.name}`}
          className="tabular w-[56px] text-right"
          onChange={(event) => setQty(event.target.value)}
          onBlur={() => void saveQty()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>

      <div className="w-[92px] text-right">
        <div className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          Suggested
        </div>
        <div
          data-testid="line-suggested"
          className="money text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
        >
          {formatMoneyTrim(item.suggestedUnitCents, currency)}
        </div>
      </div>

      <div className="w-[104px]">
        <label
          className="block text-right text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
          htmlFor={`price-${item.id}`}
        >
          Actual
        </label>
        <Input
          id={`price-${item.id}`}
          data-testid="line-actual"
          value={price}
          aria-label={`Price for ${item.name}`}
          className="money text-right"
          onChange={(event) => setPrice(event.target.value)}
          onBlur={() => void savePrice()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>

      <IconButton
        label={`Remove ${item.name}`}
        onClick={() => void removeLine()}
        icon={<Trash size={16} weight="bold" aria-hidden="true" />}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the panel                                                                  */
/* -------------------------------------------------------------------------- */

export function DealServicesPanel(props: {
  dealId: string;
  currency: string;
  /** Won deals are the only ones that can be earning, or stop earning. */
  isWon: boolean;
  recurringStartedOn: string | null;
  recurringEndedOn: string | null;
}) {
  const { dealId, currency, isWon, recurringStartedOn, recurringEndedOn } = props;
  const { data: items } = useDealItems(dealId);
  const [addingCustom, setAddingCustom] = useState(false);
  const [newServiceOpen, setNewServiceOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");

  const lines = items ?? [];
  const totals = useMemo(() => totalsFor(lines), [lines]);
  const hasRecurring = totals.recurringMonthlyCents > 0;

  function openNewService(initialName: string) {
    setNewServiceName(initialName);
    setNewServiceOpen(true);
  }

  /** A quick-form save both writes the catalog row (already done by the
   *  dialog itself) and adds it to this deal, in the same motion the picker
   *  promises. */
  async function addCreatedService(service: Product) {
    try {
      await dealItemsRepo.addFromProduct(dealId, service.id);
      await invalidateDealMoney();
    } catch (err) {
      report(err, "That service was not added.");
    }
  }

  async function endRecurring() {
    try {
      await dealItemsRepo.endRecurring(dealId);
      await invalidateDealMoney();
      toast.success("Ended the recurring service. The lines are still here.");
    } catch (err) {
      report(err, "That did not save.");
    }
  }

  async function resumeRecurring() {
    try {
      await dealItemsRepo.resumeRecurring(dealId);
      await invalidateDealMoney();
      toast.success("Back on the books.");
    } catch (err) {
      report(err, "That did not save.");
    }
  }

  return (
    <section data-testid="deal-services-panel">
      <div className="flex items-end justify-between gap-[var(--space-3)]">
        <CardGroupLabel>Services</CardGroupLabel>
        <div className="w-[240px] pb-[var(--space-2)]">
          <AddServicesControl
            dealId={dealId}
            lines={lines}
            onCustom={() => setAddingCustom(true)}
            onNewService={openNewService}
          />
        </div>
      </div>

      <NewServiceDialog
        open={newServiceOpen}
        onOpenChange={setNewServiceOpen}
        initialName={newServiceName}
        onCreated={(service) => addCreatedService(service)}
      />

      <Card>
        {lines.length === 0 && !addingCustom ? (
          <div className="px-[var(--space-4)] py-[var(--space-5)]">
            {/* No glyph: DESIGN.md keeps a spot illustration out of an empty
                state, and one sentence is the whole of what this one has to
                say. */}
            <p className="text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
              Nothing priced yet. Add a service and the value works itself out.
            </p>
          </div>
        ) : null}

        {lines.map((item) => (
          <ServiceRow key={item.id} item={item} currency={currency} />
        ))}

        {addingCustom ? (
          <CustomLineRow dealId={dealId} onDone={() => setAddingCustom(false)} />
        ) : null}

        {lines.length > 0 ? (
          <div className="border-t border-[var(--color-border-strong)] px-[var(--space-4)] py-[var(--space-3)]">
            <div className="flex items-baseline justify-between gap-[var(--space-4)]">
              <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Suggested
              </span>
              <span
                data-testid="totals-suggested"
                className="money text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
              >
                {formatMoneyTrim(totals.suggestedTotalCents, currency)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-[var(--space-4)]">
              <span className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                Actual
              </span>
              <span
                data-testid="totals-actual"
                className="money text-[length:var(--text-lg)] font-medium text-[var(--color-text)]"
              >
                {formatMoneyTrim(totals.valueCents, currency)}
              </span>
            </div>
            {totals.discountCents > 0 ? (
              <div className="flex items-baseline justify-end">
                <span
                  data-testid="totals-discount"
                  className="money text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                >
                  -{formatMoneyTrim(totals.discountCents, currency)}
                </span>
              </div>
            ) : null}
            <p
              data-testid="totals-breakdown"
              className="money mt-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text)]"
            >
              {formatBreakdown(totals.oneTimeCents, totals.recurringMonthlyCents, {
                currency,
                upfrontLabel: true,
              })}
            </p>

            {isWon && hasRecurring ? (
              <div className="mt-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                <span className="tabular text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {recurringEndedOn
                    ? `Recurring ended ${formatDateDisplay(recurringEndedOn)}`
                    : recurringStartedOn
                      ? `Recurring since ${formatDateDisplay(recurringStartedOn)}`
                      : "Recurring has not started yet"}
                </span>
                {recurringEndedOn ? (
                  <Button variant="ghost" onClick={() => void resumeRecurring()}>
                    Put it back
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    data-testid="end-recurring"
                    onClick={() => void endRecurring()}
                  >
                    End recurring
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
