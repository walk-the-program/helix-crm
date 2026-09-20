/**
 * A catalog row, as a line on a quote or an invoice.
 *
 * One function, in one place, because three callers need the same mapping and
 * getting it wrong is a wrong price on a document: the services picker adding
 * a ticked row, the quick "New service..." form adding the row it just saved,
 * and the line editor turning either into a `DraftLine`. A recurring service
 * carries its interval across; a one-time one has none to carry.
 */

/**
 * One line the services picker hands back, in the shape the line editor
 * stores. It lives here rather than beside the dialog because the dialog, the
 * quick form and the two screens that consume them all need it, and a type
 * that a lib and a component pass back and forth belongs to the lib.
 */
export type PickedService = {
  name: string;
  description: string | null;
  unitCents: number;
  taxable: boolean;
  kind: "one_time" | "recurring";
  interval: "month" | "year" | null;
};

export function productToPickedService(product: {
  name: string;
  description: string | null;
  unitPriceCents: number;
  taxable: boolean;
  kind: "one_time" | "recurring";
  interval: "month" | "year" | null;
}): PickedService {
  return {
    name: product.name,
    description: product.description,
    unitCents: product.unitPriceCents,
    taxable: product.taxable,
    kind: product.kind,
    interval: product.interval,
  };
}
