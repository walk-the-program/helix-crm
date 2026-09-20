/**
 * The catalog row to invoice line mapping. Pure, so a wrong price on a
 * document is caught here rather than on a PDF.
 */
import { describe, expect, it } from "vitest";
import { productToPickedService } from "../../../src/features/invoices/lib/newService";

describe("productToPickedService", () => {
  it("maps a catalog row to a line with the same name, price, taxability, kind and interval", () => {
    const picked = productToPickedService({
      name: "Mulch delivery",
      description: "One cubic yard, delivered.",
      unitPriceCents: 8500,
      taxable: true,
      kind: "recurring",
      interval: "year",
    });
    expect(picked).toEqual({
      name: "Mulch delivery",
      description: "One cubic yard, delivered.",
      unitCents: 8500,
      taxable: true,
      kind: "recurring",
      interval: "year",
    });
  });
});
