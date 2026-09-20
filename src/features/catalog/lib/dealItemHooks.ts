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
import { ck } from "@/features/catalog/lib/hooks";

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

// The "Add services" picker (`DealServicesPanel`) reads the catalog through
// `products.search` directly - it is already ranked and already excludes
// inactive and deleted services, so there is no client-side product list to
// cache here any more (the plain `useActiveProducts()` this file used to
// export served the old substring-filtered picker, which is gone).

export async function invalidateDealMoney(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dealItems"] }),
    queryClient.invalidateQueries({ queryKey: ["deal"] }),
    queryClient.invalidateQueries({ queryKey: ["deals"] }),
    queryClient.invalidateQueries({ queryKey: ["board"] }),
    queryClient.invalidateQueries({ queryKey: ["revenue"] }),
    queryClient.invalidateQueries({ queryKey: ["today"] }),
    // A line added or removed changes how many deals a service is on, which
    // the "/services" page shows per row.
    queryClient.invalidateQueries({ queryKey: ck.dealCounts() }),
  ]);
}
