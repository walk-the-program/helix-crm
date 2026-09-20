/**
 * The queries and small hooks every records screen shares.
 *
 * Reads go through TanStack Query with the keys in `src/app/queryClient.ts`;
 * writes invalidate through `mutations.ts`. Nothing here holds SQL: the
 * repositories are the only data access.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import * as pipelines from "@/db/repos/pipelines";
import * as stagesRepo from "@/db/repos/stages";
import * as tagsRepo from "@/db/repos/tags";
import * as sourcesRepo from "@/db/repos/sources";
import * as customFieldsRepo from "@/db/repos/customFields";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import * as dealsRepo from "@/db/repos/deals";
import * as tasksRepo from "@/db/repos/tasks";
import * as activitiesRepo from "@/db/repos/activities";
import * as moneyRepo from "@/db/repos/money";

/* -------------------------------------------------------------------------- */
/* small generic hooks                                                        */
/* -------------------------------------------------------------------------- */

/** Search-as-you-type without a query per keystroke. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Inline editing with no save button: the field debounces, writes, and shows
 * "Saved". The indicator stays for two seconds so a two-finger typist sees it,
 * and an error stays until the next successful save.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<void>,
  options: { delay?: number; onError?: (err: unknown) => void } = {},
): {
  state: SaveState;
  schedule: (value: T) => void;
  flush: () => void;
} {
  const delay = options.delay ?? 600;
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<number | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  const onErrorRef = useRef(options.onError);
  const mounted = useRef(true);

  saveRef.current = save;
  onErrorRef.current = options.onError;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setState("saving");
    void saveRef
      .current(next.value)
      .then(() => {
        if (!mounted.current) return;
        setState("saved");
        window.setTimeout(() => {
          if (mounted.current) setState((s) => (s === "saved" ? "idle" : s));
        }, 2000);
      })
      .catch((err: unknown) => {
        if (mounted.current) setState("error");
        onErrorRef.current?.(err);
      });
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(run, delay);
    },
    [delay, run],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    run();
  }, [run]);

  return { state, schedule, flush };
}

/* -------------------------------------------------------------------------- */
/* workspace-level reads                                                      */
/* -------------------------------------------------------------------------- */

export function usePipeline() {
  return useQuery({
    queryKey: qk.pipelines(),
    queryFn: () => pipelines.getDefault(),
  });
}

export function useStages(pipelineId: string | undefined) {
  return useQuery({
    queryKey: qk.stages(pipelineId),
    queryFn: () => (pipelineId ? stagesRepo.list(pipelineId) : Promise.resolve([])),
    enabled: Boolean(pipelineId),
  });
}

export function useStageSummary(pipelineId: string | undefined) {
  return useQuery({
    queryKey: ["stages", "summary", pipelineId ?? null],
    queryFn: () => (pipelineId ? stagesRepo.summary(pipelineId) : Promise.resolve([])),
    enabled: Boolean(pipelineId),
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk.tags(),
    queryFn: async () => (await tagsRepo.list()).rows,
  });
}

export function useEntityTags(entityType: tagsRepo.TaggedEntityType, entityId: string) {
  return useQuery({
    queryKey: ["tags", entityType, entityId],
    queryFn: () => tagsRepo.listForEntity(entityType, entityId),
  });
}

/**
 * Which tags sit on which rows, for a whole list at once. There is no
 * "tags for many entities" repository function, so this walks the workspace's
 * tags — a handful of rows — and asks for each one's entity ids. Reported for
 * promotion in STATUS.
 */
export function useEntityTagIndex(entityType: tagsRepo.TaggedEntityType) {
  return useQuery({
    queryKey: ["tags", "index", entityType],
    queryFn: async () => {
      const { rows } = await tagsRepo.list();
      const index = new Map<string, tagsRepo.Tag[]>();
      for (const tag of rows) {
        const ids = await tagsRepo.listEntityIdsForTag(tag.id, entityType);
        for (const id of ids) {
          const existing = index.get(id);
          if (existing) existing.push(tag);
          else index.set(id, [tag]);
        }
      }
      return index;
    },
  });
}

export function useSources() {
  return useQuery({
    queryKey: qk.sources(),
    queryFn: async () => (await sourcesRepo.list()).rows,
  });
}

export function useCustomFields(entityType: string) {
  return useQuery({
    queryKey: qk.customFields(entityType),
    queryFn: () => customFieldsRepo.list(entityType),
  });
}

export function useCustomValues(entityId: string) {
  return useQuery({
    queryKey: ["customValues", entityId],
    queryFn: () => customFieldsRepo.listValues(entityId),
  });
}

/* -------------------------------------------------------------------------- */
/* records                                                                    */
/* -------------------------------------------------------------------------- */

export function useContacts(filter: contactsRepo.ContactFilter, limit = 2000) {
  return useQuery({
    queryKey: qk.contacts({ ...filter, limit }),
    queryFn: () => contactsRepo.list(filter, { limit }),
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: qk.contact(id),
    queryFn: () => contactsRepo.get(id),
  });
}

export function useCompanies(filter: companiesRepo.CompanyFilter, limit = 2000) {
  return useQuery({
    queryKey: qk.companies({ ...filter, limit }),
    queryFn: () => companiesRepo.list(filter, { limit }),
  });
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: qk.company(id),
    queryFn: () => companiesRepo.get(id),
  });
}

export function useCompanyCounts(id: string) {
  return useQuery({
    queryKey: ["company", id, "counts"],
    queryFn: () => companiesRepo.counts(id),
  });
}

export function useDeals(filter: dealsRepo.DealFilter, limit = 2000) {
  return useQuery({
    queryKey: qk.deals({ ...filter, limit }),
    queryFn: () => dealsRepo.list(filter, { limit }),
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: qk.deal(id),
    queryFn: () => dealsRepo.get(id),
  });
}

export function useBoard(pipelineId: string | undefined) {
  return useQuery({
    queryKey: qk.board(pipelineId ?? "none"),
    queryFn: () => (pipelineId ? dealsRepo.board(pipelineId) : Promise.resolve([])),
    enabled: Boolean(pipelineId),
  });
}

export function useTasks(filter: tasksRepo.TaskFilter, limit = 1000) {
  return useQuery({
    queryKey: qk.tasks({ ...filter, limit }),
    queryFn: () => tasksRepo.list(filter, { limit }),
  });
}

export function useActivities(filter: activitiesRepo.ActivityFilter, limit = 200) {
  return useQuery({
    queryKey: qk.activities({ ...filter, limit }),
    queryFn: () => activitiesRepo.list(filter, { limit }),
  });
}

/* -------------------------------------------------------------------------- */
/* money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The four figures for one deal. `src/db/repos/money.ts` is the single place
 * these are defined (docs/rounds/2026-09-20-round-3.md, "Money model") - no
 * screen re-derives them from lines or documents.
 */
export function useDealMoney(dealId: string) {
  return useQuery({
    queryKey: ["money", "deal", dealId],
    queryFn: () => moneyRepo.dealMoney(dealId),
    enabled: dealId.length > 0,
  });
}

/** Lifetime figures for a customer: a contact, a company, or a person at one. */
export function useCustomerMoney(ref: moneyRepo.CustomerRef) {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  return useQuery({
    queryKey: ["money", "customer", contactId, companyId],
    queryFn: () => moneyRepo.customerMoney({ contactId, companyId }),
    enabled: contactId !== null || companyId !== null,
  });
}
