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
import { useMemo, useState } from "react";
import { Check, Plus, Trash, X } from "@/ui/icons";
import {
  Button,
  Card,
  CardGroupLabel,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  toast,
} from "@/ui";
import * as dealItemsRepo from "@/db/repos/dealItems";
import { totalsFor, type DealItem } from "@/db/repos/dealItems";
import {
  centsToDecimalString,
  formatBreakdown,
  formatMoneyTrim,
  parseMoneyToCents,
} from "@/lib/money";
import { formatDateDisplay } from "@/lib/dates";
import {
  invalidateDealMoney,
  useActiveProducts,
  useDealItems,
} from "@/features/catalog/lib/dealItemHooks";

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
 * A searchable list of the price list, plus one way out of it.
 *
 * "Custom line" is not an afterthought: half of what a trade sells on any given
 * day is not on a price list, and a picker that forces a catalog row first
 * would have the owner inventing junk services to get past it.
 */
function AddServiceMenu(props: { dealId: string; onCustom: () => void }) {
  const { dealId, onCustom } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: products } = useActiveProducts();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = products ?? [];
    if (needle.length === 0) return rows;
    return rows.filter((product) => product.name.toLowerCase().includes(needle));
  }, [products, query]);

  async function addProduct(productId: string) {
    setOpen(false);
    setQuery("");
    try {
      await dealItemsRepo.addFromProduct(dealId, productId);
      await invalidateDealMoney();
    } catch (err) {
      report(err, "That service was not added.");
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          data-testid="add-service"
          iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
        >
          Add a service
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end">
        <div className="border-b border-[var(--color-border)] p-[var(--space-2)]">
          <Input
            autoFocus
            value={query}
            placeholder="Search your services"
            aria-label="Search your services"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
              {(products ?? []).length === 0
                ? "No services yet. Add them under Settings, Services."
                : "Nothing matches that."}
            </p>
          ) : (
            matches.map((product) => (
              <button
                key={product.id}
                type="button"
                data-testid="add-service-option"
                onClick={() => void addProduct(product.id)}
                className="flex min-h-[var(--control-h-sm)] w-full items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-left hover:bg-[var(--color-selected)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-base)] text-[var(--color-text)]">
                  {product.name}
                </span>
                <span className="money flex-none text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {formatMoneyTrim(product.unitPriceCents)}
                </span>
                <span className="flex-none text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
                  {chargeLabel(product.kind, product.interval)}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[var(--color-border)]">
          <button
            type="button"
            data-testid="add-custom-line"
            onClick={() => {
              setOpen(false);
              setQuery("");
              onCustom();
            }}
            className="flex min-h-[var(--control-h-sm)] w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-base)] text-[var(--color-text)] hover:bg-[var(--color-selected)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
            Custom line
          </button>
        </div>
      </PopoverContent>
    </Popover>
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

  async function savePrice() {
    const cents = parseMoneyToCents(price);
    if (cents === null || cents === item.actualUnitCents) {
      setPrice(centsToDecimalString(item.actualUnitCents));
      return;
    }
    try {
      await dealItemsRepo.update(item.id, { actualUnitCents: cents });
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

  const lines = items ?? [];
  const totals = useMemo(() => totalsFor(lines), [lines]);
  const hasRecurring = totals.recurringMonthlyCents > 0;

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
        <div className="pb-[var(--space-2)]">
          <AddServiceMenu dealId={dealId} onCustom={() => setAddingCustom(true)} />
        </div>
      </div>

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
