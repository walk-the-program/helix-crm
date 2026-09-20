/**
 * The queries behind the deal page's Services panel.
 *
 * Keys are local strings rather than entries in `src/app/queryClient.ts`,
 * because a feature does not own that file. `invalidateDealMoney` is the one
 * thing every write in the panel calls: a line change rewrites the deal's
 * value in the same transaction, so the deal row, the board and the lists are
 * all stale the moment a line moves, and invalidating only the lines would
 * leave the money on screen wrong.
 */
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import * as dealItemsRepo from "@/db/repos/dealItems";
import * as productsRepo from "@/db/repos/products";

export const catalogKeys = {
  dealItems: (dealId: string) => ["dealItems", dealId] as const,
  products: (filter?: unknown) => ["products", filter ?? null] as const,
  revenue: (today: string) => ["revenue", today] as const,
};

export function useDealItems(dealId: string) {
  return useQuery({
    queryKey: catalogKeys.dealItems(dealId),
    queryFn: () => dealItemsRepo.list(dealId),
    enabled: dealId.length > 0,
  });
}

/** The active price list, for the "Add a service" picker. */
export function useActiveProducts() {
  return useQuery({
    queryKey: catalogKeys.products({ activeOnly: true }),
    queryFn: async () => (await productsRepo.list({ activeOnly: true }, { limit: 500 })).rows,
  });
}

export async function invalidateDealMoney(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dealItems"] }),
    queryClient.invalidateQueries({ queryKey: ["deal"] }),
    queryClient.invalidateQueries({ queryKey: ["deals"] }),
    queryClient.invalidateQueries({ queryKey: ["board"] }),
    queryClient.invalidateQueries({ queryKey: ["revenue"] }),
    queryClient.invalidateQueries({ queryKey: ["today"] }),
  ]);
}
