/**
 * The create/edit dialog for one catalog row, following
 * `TemplatesScreen`'s single-dialog-for-both shape: one form, reset on every
 * open (keyed on the dialog opening, not on every keystroke), so Escape or
 * the close button always abandons the draft.
 *
 * "How is it charged?" is a three-way choice - one time, every month, every
 * year - rather than a separate kind toggle plus an interval field, because
 * that is the sentence the owner is actually answering. It is translated to
 * the repository's `kind` / `interval` pair on save so the UI can never send
 * the contradiction the repo already guards against (a one-time product with
 * an interval, or a recurring one without).
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
  Textarea,
} from "@/ui";
import { parseMoneyToCents, centsToDecimalString } from "@/lib/money";
import { useCreateService, useUpdateService } from "@/features/catalog/lib/hooks";
import type { Product, ProductInterval, ProductKind } from "@/db/repos/products";

type Charge = "one_time" | "month" | "year";

const CHARGE_OPTIONS: { value: Charge; label: string }[] = [
  { value: "one_time", label: "One time" },
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
];

function chargeFor(kind: ProductKind, interval: ProductInterval | null): Charge {
  if (kind === "one_time") return "one_time";
  return interval ?? "month";
}

export function ServiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Product | null;
}) {
  const { open, onOpenChange, service } = props;
  const editing = Boolean(service);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [charge, setCharge] = useState<Charge>("one_time");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(false);
  const [active, setActive] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const create = useCreateService();
  const update = useUpdateService();
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setCharge(service ? chargeFor(service.kind, service.interval) : "one_time");
    setPrice(service ? centsToDecimalString(service.unitPriceCents) : "");
    setTaxable(service?.taxable ?? false);
    setActive(service?.active ?? true);
    setNameError(null);
    setPriceError(null);
    setSaveError(null);
  }, [open, service]);

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
      if (service) {
        await update.mutateAsync({
          id: service.id,
          patch: {
            name: trimmedName,
            description: description.trim().length > 0 ? description : null,
            kind,
            interval,
            unitPriceCents: cents as number,
            taxable,
            active,
          },
        });
      } else {
        await create.mutateAsync({
          name: trimmedName,
          description: description.trim().length > 0 ? description : null,
          kind,
          interval,
          unitPriceCents: cents as number,
          taxable,
          active,
        });
      }
      onOpenChange(false);
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
      <DialogContent size="md" data-testid="service-editor">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit service" : "Add a service"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="Name" htmlFor="service-name" required error={nameError ?? undefined}>
            <Input
              id="service-name"
              data-testid="service-name-input"
              placeholder="Gutter cleaning"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>

          <Field label="Description" htmlFor="service-description">
            <Textarea
              id="service-description"
              rows={3}
              placeholder="What this covers, if it needs a sentence."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label="How is it charged?" htmlFor="service-charge">
            <Select
              id="service-charge"
              aria-label="How is it charged?"
              value={charge}
              options={CHARGE_OPTIONS}
              onValueChange={(v) => setCharge(v as Charge)}
            />
          </Field>

          <Field
            label="Price"
            htmlFor="service-price"
            required
            error={priceError ?? undefined}
          >
            <Input
              id="service-price"
              data-testid="service-price-input"
              inputMode="decimal"
              placeholder="150"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                if (priceError) setPriceError(null);
              }}
            />
          </Field>

          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center justify-between gap-[var(--space-3)]">
              <label htmlFor="service-taxable" className="text-[length:var(--text-sm)] text-[var(--color-text)]">
                Taxable
              </label>
              <Switch id="service-taxable" checked={taxable} onCheckedChange={setTaxable} />
            </div>
            <div className="flex items-center justify-between gap-[var(--space-3)]">
              <label htmlFor="service-active" className="text-[length:var(--text-sm)] text-[var(--color-text)]">
                Active
              </label>
              <Switch id="service-active" checked={active} onCheckedChange={setActive} />
            </div>
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
            data-testid="service-save"
            onClick={() => void save()}
          >
            {editing ? "Save changes" : "Add service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
