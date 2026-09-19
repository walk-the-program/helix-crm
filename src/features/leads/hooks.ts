/**
 * React bindings for the lead poller and the site connection.
 *
 * `usePollStatus` is a `useSyncExternalStore` over the poller's own store, so
 * Today and Diagnostics can show poll status without importing the timer.
 */
import { useSyncExternalStore } from "react";
import { getStatus, subscribe } from "@/features/leads/poller";
import type { PollStatus } from "@/features/leads/lib/types";

export function usePollStatus(): PollStatus {
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}

/** Query keys for anything the poller touches, kept beside the feature. */
export const leadKeys = {
  connection: () => ["leads", "connection"] as const,
  sync: (origin: string | null) => ["leads", "sync", origin] as const,
};
