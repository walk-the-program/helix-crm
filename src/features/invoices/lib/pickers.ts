/**
 * The kit primitives this feature picks records and dates with, named in one
 * place.
 *
 * Round 3 moved every contact, company and date field in the product onto
 * three shared primitives the shell agent owns. They are not re-exported from
 * src/ui/index.ts yet, so every screen here imports them through this module
 * rather than spelling the deep path five times; when index.ts carries them,
 * the three lines below become one.
 */
export { Combobox, type ComboboxItem } from "@/ui/Combobox";
export { DatePicker } from "@/ui/DatePicker";
