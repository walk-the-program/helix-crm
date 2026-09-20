/**
 * The recurring feature's data layer: one hook per question, all of them on
 * keys this file owns, plus `qk.today()` so the Coming up section refreshes
 * when a rule changes anywhere in the app.
 *
 * `src/app/queryClient.ts` belongs to the shell and has no "recurring" key, so
 * the keys live here. They are plain arrays with "recurring" first, which is
 * all an invalidation needs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk, queryClient } from "@/app/queryClient";
import * as recurringRepo from "@/db/repos/recurring";
import * as activitiesRepo from "@/db/repos/activities";
import { todayLocal } from "@/lib/dates";
import { toast } from "@/ui";
import type {
  NewRecurringRule,
  RecurringDue,
  RecurringPatch,
  RecurringRule,
} from "@/db/repos/recurring";

/** How far ahead Today looks. Fixed at seven days, like the task buckets. */
export const COMING_UP_DAYS = 7;

export const rk = {
  all: () => ["recurring"] as const,
  list: (filter?: unknown) => ["recurring", "list", filter ?? null] as const,
  due: (reference: string) => ["recurring", "due", reference] as const,
};

export async function invalidateRecurring(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: rk.all() }),
    queryClient.invalidateQueries({ queryKey: qk.today() }),
    queryClient.invalidateQueries({ queryKey: qk.activities() }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every rule with the customer it is about, for the Reminders screen.
 *
 * The screen needs the name, not the id: "Open the contact" in a column is a
 * link to nowhere the owner recognises. One join, shared with Today's section.
 */
export function useRecurringRules(filter: recurringRepo.RecurringFilter = {}) {
  return useQuery({
    queryKey: rk.list(filter),
    queryFn: () => recurringRepo.listWithWho(filter),
  });
}

/** The rules on one record, for the panel on a contact or company page. */
export function useRecurringFor(target: { contactId?: string; companyId?: string }) {
  const filter = target.contactId
    ? { contactId: target.contactId }
    : { companyId: target.companyId };
  return useQuery({
    queryKey: rk.list(filter),
    queryFn: () => recurringRepo.list(filter, { limit: 100 }),
    enabled: Boolean(target.contactId ?? target.companyId),
  });
}

/** What Today's Coming up section shows. */
export function useComingUp(reference: string = todayLocal()) {
  return useQuery({
    queryKey: rk.due(reference),
    queryFn: (): Promise<RecurringDue[]> =>
      recurringRepo.dueSoon(reference, COMING_UP_DAYS),
  });
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export function useCreateRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRecurringRule): Promise<RecurringRule> =>
      recurringRepo.create(input),
    onSuccess: async () => {
      await invalidateRecurring();
      void client.invalidateQueries({ queryKey: rk.all() });
    },
  });
}

export function useUpdateRule() {
  return useMutation({
    mutationFn: (input: { id: string; patch: RecurringPatch }) =>
      recurringRepo.update(input.id, input.patch),
    onSuccess: invalidateRecurring,
  });
}

export function useSetRuleActive() {
  return useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      recurringRepo.setActive(input.id, input.active),
    onSuccess: invalidateRecurring,
  });
}

/**
 * "Done": advance the date, stamp the completion, and write the timeline entry
 * that says the work happened.
 *
 * The system entry is written here rather than inside the repository, because a
 * repository that writes another table behind the caller's back is how the same
 * event ends up logged twice. Two sequential calls, never nested: the write
 * lock does not reenter.
 */
export function useCompleteRule() {
  return useMutation({
    mutationFn: async (rule: RecurringRule): Promise<RecurringRule> => {
      const advanced = await recurringRepo.complete(rule.id);
      if (rule.contactId || rule.companyId) {
        await activitiesRepo.createSystem({
          body: `${rule.title} done. Next one due ${advanced.nextDueOn}.`,
          contactId: rule.contactId,
          companyId: rule.companyId,
        });
      }
      return advanced;
    },
    onSuccess: invalidateRecurring,
  });
}

/** "Skip this one": the date moves and nothing claims the work was done. */
export function useSkipRule() {
  return useMutation({
    mutationFn: (rule: RecurringRule) => recurringRepo.skip(rule.id),
    onSuccess: invalidateRecurring,
  });
}

/** Soft delete with ten seconds of Undo, the same contract as everywhere else. */
export function useDeleteRule() {
  return useMutation({
    mutationFn: async (rule: RecurringRule): Promise<void> => {
      await recurringRepo.softDelete(rule.id);
      await invalidateRecurring();
      toast.undo(`Deleted "${rule.title}"`, () => {
        void (async () => {
          try {
            await recurringRepo.restore(rule.id);
            await invalidateRecurring();
            toast.success(`Restored "${rule.title}"`);
          } catch {
            toast.error(`Could not restore "${rule.title}".`);
          }
        })();
      });
    },
  });
}
