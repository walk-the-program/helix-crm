/**
 * The Services import: the work an owner sells, priced, so quotes and invoices
 * have something to be built from.
 *
 *   row --> guess columns --> parseCell per field --> Draft --> products row
 *                                                       |
 *                                            { name, description,
 *                                              price, billing, taxable }
 *
 * `name` is the one required field, and it is also the key: a service already
 * in the catalogue is matched on its name, so re-importing a price list does
 * not give the owner two of everything.
 *
 * Billing is the shape `products` wants, said in the owner's words. "One-time"
 * is kind 'one_time' with no interval; "Monthly" and "Yearly" are kind
 * 'recurring' with interval 'month' or 'year'. A recurring service always
 * carries an interval and a one-time one never does - src/db/repos/products.ts
 * is strict about that, because the MRR report reads the interval directly.
 */
import type { ImportTypeDefinition } from "@/features/data/import/fields/types";

export const SERVICES_IMPORT: ImportTypeDefinition = {
  id: "services",
  label: "Services",
  noun: "services",
  hint: "The work you sell, with its price. Used to build quotes and invoices.",
  exampleFileName: "helix-services-example.csv",
  fields: [
    {
      key: "name",
      label: "Service",
      required: true,
      parser: "text",
      aliases: [
        "name",
        "service",
        "service name",
        "product",
        "product name",
        "item",
        "item name",
        "description of work",
      ],
      examples: [
        "Water heater replacement",
        "Monthly lawn care",
        "Annual furnace tune-up",
      ],
    },
    {
      key: "description",
      label: "Description",
      parser: "text",
      aliases: ["description", "details", "notes", "what it includes", "summary"],
      examples: [
        "Swap out an old tank for a new 50-gallon unit, haul the old one away.",
        "Mow, edge and blow, every other week through the growing season.",
        "Inspect, clean and tune the furnace before the first cold snap.",
      ],
    },
    {
      key: "price",
      label: "Price",
      parser: "money",
      aliases: ["price", "unit price", "rate", "amount", "cost", "list price", "price usd"],
      examples: ["$1,450.00", "$185.00", "$249.00"],
    },
    {
      key: "billing",
      label: "Billing",
      parser: "choice",
      aliases: ["billing", "billing period", "billing cycle", "frequency", "recurrence", "interval", "per"],
      choices: [
        { value: "One-time", aliases: ["one time", "once", "onetime", "single", "fixed", "flat"] },
        { value: "Monthly", aliases: ["month", "per month", "monthly", "recurring monthly", "mo"] },
        { value: "Yearly", aliases: ["year", "per year", "yearly", "annual", "annually", "yr"] },
      ],
      examples: ["One-time", "Monthly", "Yearly"],
    },
    {
      key: "taxable",
      label: "Taxable",
      parser: "choice",
      aliases: ["taxable", "tax", "sales tax", "is taxable"],
      choices: [
        { value: "Yes", aliases: ["y", "true", "1", "taxable"] },
        { value: "No", aliases: ["n", "false", "0", "exempt", "not taxable"] },
      ],
      examples: ["Yes", "No", "Yes"],
    },
  ],
};
