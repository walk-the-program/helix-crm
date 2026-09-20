/**
 * The service catalog's own data layer.
 *
 * `src/app/queryClient.ts` has no "catalog" key, so this file owns its own
 * query keys, the same way `src/features/templates/lib/hooks.ts` owns `tk`.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import * as productsRepo from "@/db/repos/products";
import { toast } from "@/ui";
import type { NewProduct, Product, ProductPatch } from "@/db/repos/products";

export const ck = {
  all: () => ["catalog"] as const,
  list: () => ["catalog", "services", "list"] as const,
  dealCounts: () => ["catalog", "services", "dealCounts"] as const,
};

export async function invalidateServices(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ck.all() });
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Every live service, one-time and recurring together. */
export function useServices() {
  return useQuery({
    queryKey: ck.list(),
    queryFn: async (): Promise<Product[]> => {
      const { rows } = await productsRepo.list();
      return rows;
    },
  });
}

/**
 * How many live deals use each service, for the "/services" page's list. One
 * query for the whole catalog rather than one per row - see
 * `productsRepo.dealCounts`.
 */
export function useDealCounts() {
  return useQuery({
    queryKey: ck.dealCounts(),
    queryFn: (): Promise<Map<string, number>> => productsRepo.dealCounts(),
  });
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export function useCreateService() {
  return useMutation({
    mutationFn: (input: NewProduct): Promise<Product> => productsRepo.create(input),
    onSuccess: invalidateServices,
  });
}

export function useUpdateService() {
  return useMutation({
    mutationFn: (input: { id: string; patch: ProductPatch }): Promise<Product> =>
      productsRepo.update(input.id, input.patch),
    onSuccess: invalidateServices,
  });
}

export function useReorderServices() {
  return useMutation({
    mutationFn: (orderedIds: string[]): Promise<void> => productsRepo.reorder(orderedIds),
    onSuccess: invalidateServices,
  });
}

/**
 * The row menu's Delete: `removeOrDeactivate` deletes a service nothing
 * quotes and deactivates one a deal already uses instead, because that
 * deal's price history has to survive. Only the "deleted" outcome gets an
 * Undo - a deactivation is reversible from the row menu itself
 * (Activate), so it does not need its own toast action.
 */
export function useDeleteOrDeactivateService() {
  return useMutation({
    mutationFn: async (
      service: Product,
    ): Promise<{ outcome: "deleted" | "deactivated" }> => {
      const result = await productsRepo.removeOrDeactivate(service.id);
      await invalidateServices();
      if (result.outcome === "deactivated") {
        toast.success(
          `Deactivated ${service.name}. A deal already uses it, so it was kept.`,
        );
      } else {
        toast.undo(`Deleted ${service.name}.`, () => {
          void (async () => {
            try {
              await productsRepo.restore(service.id);
              await invalidateServices();
              toast.success(`Restored ${service.name}.`);
            } catch {
              toast.error(`Could not restore ${service.name}.`);
            }
          })();
        });
      }
      return result;
    },
  });
}
