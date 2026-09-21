/**
 * Fresh pages.
 *
 * Everything on screen comes from the local SQLite file through TanStack
 * Query, so a refetch costs a few milliseconds and never a spinner: the cached
 * rows stay on screen while the new ones arrive. That makes three rules cheap
 * enough to be the default:
 *
 * 1. **Every page open or switch refetches.** `queryClient` runs with
 *    `staleTime: 0`, so a screen that mounts always asks the database again,
 *    and `useRefreshOnNavigate` invalidates whatever is still mounted (the
 *    shell's own counts, Today's sections) when the route changes.
 * 2. **Coming back to the app refetches.** `refetchOnWindowFocus` is on; a
 *    lead that arrived while the owner was in Mail is on Today when they
 *    return.
 * 3. **The owner can always ask.** "Refresh" is a command (mod+R, View menu,
 *    palette) that invalidates every query and says so.
 *
 * Why the owner asked for this: after an import, a poll or a change on another
 * screen, a page that stayed mounted kept showing what it had loaded, and
 * nothing on it said the numbers were minutes old.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { FeatureCommand } from "@/app/feature";
import { queryClient } from "@/app/queryClient";

export const REFRESH_SHORTCUT = "mod+r";

/** Refetch every active query; the cached rows stay on screen meanwhile. */
export async function refreshAll(options: { announce?: boolean } = {}): Promise<void> {
  await queryClient.invalidateQueries();
  if (options.announce) toast.success("Refreshed.");
}

/**
 * Invalidate every query each time the route changes, so a screen that was
 * already mounted (or is reached through the back button) reflects what the
 * database holds now. The first render is not a change: the boot has just
 * filled the cache.
 */
export function useRefreshOnNavigate(location: string): void {
  const previous = useRef(location);
  useEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    void queryClient.invalidateQueries();
  }, [location]);
}

export const refreshCommands: FeatureCommand[] = [
  {
    id: "refresh",
    label: "Refresh this page",
    shortcut: REFRESH_SHORTCUT,
    group: "View",
    keywords: ["refresh", "reload", "update", "fetch", "stale", "sync"],
    aliases: ["reload"],
    run: () => refreshAll({ announce: true }),
  },
];
