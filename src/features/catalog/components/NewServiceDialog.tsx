/**
 * The quick create form for a service, opened from wherever a service is
 * picked and the one the owner wants is not in the catalog yet - the deal
 * page's services picker today, invoices' line picker by the same round's
 * other lead. It saves a real catalog row and hands it straight back so the
 * caller can add it as a line without a second round trip through the
 * catalog's own query cache.
 *
 * Deliberately the short sibling of `ServiceDialog` (Settings > Services):
 * same "How is it charged?" three-way choice, translated to the repository's
 * `kind` / `interval` pair the same way, same reset-on-open behaviour, same
 * error handling - but no description and no active toggle, because a
 * service created mid-pick is active by definition and a description is not
 * what stopped the owner on his way to adding a line. The full form for
 * everything else stays `ServiceDialog`.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Switch,
} from "@/ui";
import { parseMoneyToCents } from "@/lib/money";
import { useCreateService } from "@/features/catalog/lib/hooks";
import type { Product, ProductInterval, ProductKind } from "@/db/repos/products";

type Charge = "one_time" | "month" | "year";

const CHARGE_OPTIONS: { value: Charge; label: string }[] = [
  { value: "one_time", label: "One time" },
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
];

export function NewServiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the name, e.g. what the owner typed into the picker. */
  initialName?: string;
  /** The saved service, handed back so the caller can add it as a line. */
  onCreated: (service: Product) => void | Promise<void>;
}) {
  const { open, onOpenChange, initialName, onCreated } = props;

  const [name, setName] = useState("");
  const [charge, setCharge] = useState<Charge>("one_time");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const create = useCreateService();
  const saving = create.isPending;

  // Reset on open, not on close, so Escape or the close button always
  // abandons the draft rather than leaving a half-typed name to reappear.
  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    setCharge("one_time");
    setPrice("");
    setTaxable(false);
    setNameError(null);
    setPriceError(null);
    setSaveError(null);
  }, [open, initialName]);

  async function save() {
    const trimmedName = name.trim();
    let hasError = false;
    if (trimmedName.length === 0) {
      setNameError("Give the service a name you will recognise.");
      hasError = true;
    } else {
      setNameError(null);
    }

    const cents = parseMoneyToCents(price);
    if (cents === null || cents < 0) {
      setPriceError("Enter an amount, for example 150.");
      hasError = true;
    } else {
      setPriceError(null);
    }

    if (hasError) return;
    setSaveError(null);

    const kind: ProductKind = charge === "one_time" ? "one_time" : "recurring";
    const interval: ProductInterval | null = charge === "one_time" ? null : charge;

    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        kind,
        interval,
        unitPriceCents: cents as number,
        taxable,
      });
      onOpenChange(false);
      await onCreated(created);
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : "That service did not save.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="new-service-dialog">
        <DialogHeader>
          <DialogTitle>New service</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="Name" htmlFor="new-service-name" required error={nameError ?? undefined}>
            <Input
              id="new-service-name"
              data-testid="new-service-name-input"
              placeholder="Gutter cleaning"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>

          <Field label="How is it charged?" htmlFor="new-service-charge">
            <Select
              id="new-service-charge"
              aria-label="How is it charged?"
              value={charge}
              options={CHARGE_OPTIONS}
              onValueChange={(v) => setCharge(v as Charge)}
            />
          </Field>

          <Field
            label="Price"
            htmlFor="new-service-price"
            required
            error={priceError ?? undefined}
          >
            <Input
              id="new-service-price"
              data-testid="new-service-price-input"
              inputMode="decimal"
              placeholder="150"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                if (priceError) setPriceError(null);
              }}
            />
          </Field>

          <div className="flex items-center justify-between gap-[var(--space-3)]">
            <label
              htmlFor="new-service-taxable"
              className="text-[length:var(--text-sm)] text-[var(--color-text)]"
            >
              Taxable
            </label>
            <Switch id="new-service-taxable" checked={taxable} onCheckedChange={setTaxable} />
          </div>

          {saveError ? (
            <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
              {saveError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            loadingLabel="Saving"
            data-testid="new-service-save"
            onClick={() => void save()}
          >
            Add service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
