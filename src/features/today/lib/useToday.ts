/**
 * Today's data layer: one hook per section, all of them on the shared
 * TanStack Query keys from `src/app/queryClient.ts` so a write anywhere in the
 * app refreshes the right panel and nothing else.
 *
 * Everything is local SQLite, so these are cheap; the reason they are queries
 * at all is invalidation, not caching. `qk.today()` is the umbrella key every
 * section also carries, so a mutation that could touch several sections
 * (completing a task, logging a call) invalidates once.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import * as tasksRepo from "@/db/repos/tasks";
import * as dealsRepo from "@/db/repos/deals";
import * as stagesRepo from "@/db/repos/stages";
import * as activitiesRepo from "@/db/repos/activities";
import * as settingsRepo from "@/db/repos/settings";
import { nowIso, todayLocal } from "@/lib/dates";
import { newLeads, type NewLead } from "@/db/repos/deals";
import {
  lastActivityFor,
  recentWithLinks,
  type RecentEntry,
} from "@/db/repos/activities";
import { taskLinks, type TaskLink } from "@/db/repos/tasks";
import { workspaceIsEmpty } from "@/db/repos/seed";
import {
  compareQuiet,
  describeQuiet,
  quietVerdict,
  snoozeActivityBody,
} from "@/features/today/lib/goneQuiet";

/** How far back "new" reaches. PLAN item 6 fixes it at seven days. */
export const NEW_LEAD_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Due now
// ---------------------------------------------------------------------------

export type DueNowRow = {
  task: tasksRepo.Task;
  /** "Overdue 6 days" or "Due today". */
  when: string;
  overdue: boolean;
  overdueDays: number;
  link: TaskLink | null;
};

export type DueNowData = {
  rows: DueNowRow[];
  overdueCount: number;
};

function dayGap(fromDateOnly: string, toDateOnly: string): number {
  const from = Date.parse(`${fromDateOnly}T00:00:00Z`);
  const to = Date.parse(`${toDateOnly}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function useDueNow() {
  return useQuery({
    queryKey: [...qk.today(), "due-now"] as const,
    queryFn: async (): Promise<DueNowData> => {
      const reference = todayLocal();
      const buckets = await tasksRepo.today(reference);
      // Overdue first, then today's, each already ordered by due date by the
      // repository. The next seven days are deliberately left off Today:
      // DESIGN.md's rule is that every row here is a row he can act on now.
      const ordered = [...buckets.overdue, ...buckets.today];
      const links = await taskLinks(ordered.map((t) => t.id));

      const rows = ordered.map((task) => {
        const overdueDays = task.dueOn ? dayGap(task.dueOn, reference) : 0;
        const overdue = overdueDays > 0;
        return {
          task,
          overdue,
          overdueDays,
          when: overdue
            ? overdueDays === 1
              ? "Overdue 1 day"
              : `Overdue ${overdueDays} days`
            : "Due today",
          link: links.get(task.id) ?? null,
        };
      });

      return { rows, overdueCount: buckets.overdue.length };
    },
  });
}

// ---------------------------------------------------------------------------
// New leads
// ---------------------------------------------------------------------------

export function useNewLeads() {
  return useQuery({
    queryKey: [...qk.today(), "new-leads"] as const,
    queryFn: async (): Promise<NewLead[]> => {
      const since = new Date(
        Date.now() - NEW_LEAD_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      return newLeads({ sinceIso: since, limit: 25 });
    },
  });
}

// ---------------------------------------------------------------------------
// Gone quiet
// ---------------------------------------------------------------------------

export type QuietRow = {
  deal: dealsRepo.Deal;
  daysQuiet: number;
  limitDays: number;
  /** "No activity for 21 days · Limit 14 days" */
  explanation: string;
  stageColor: string;
};

export function useGoneQuiet() {
  return useQuery({
    queryKey: [...qk.today(), "gone-quiet"] as const,
    queryFn: async (): Promise<QuietRow[]> => {
      const at = nowIso();
      // The SQL rule picks the rows; the pure rule in lib/goneQuiet.ts works
      // out what each row says and re-checks the verdict. They agree by
      // construction — both compare the same max() against the same limit —
      // and the unit tests pin the second one.
      const quiet = await dealsRepo.goneQuiet(at);
      if (quiet.length === 0) return [];

      const stages = await stagesRepo.list();
      const byStage = new Map(stages.map((s) => [s.id, s]));
      const lastActivity = await lastActivityFor(quiet.map((d) => d.id));

      const rows: QuietRow[] = [];
      for (const deal of quiet) {
        const stage = byStage.get(deal.stageId);
        const verdict = quietVerdict(
          {
            stageEnteredAt: deal.stageEnteredAt,
            lastActivityAt: lastActivity.get(deal.id) ?? null,
            quietDays: stage?.quietDays ?? 0,
            stageIsWon: deal.stageIsWon,
            stageIsLost: deal.stageIsLost,
          },
          at,
        );
        if (!verdict.quiet) continue;
        rows.push({
          deal,
          daysQuiet: verdict.daysQuiet,
          limitDays: verdict.limitDays,
          explanation: describeQuiet(verdict),
          stageColor: stage?.color ?? "var(--stage-1)",
        });
      }

      return rows.sort((a, b) =>
        compareQuiet(
          { daysQuiet: a.daysQuiet, valueCents: a.deal.valueCents, title: a.deal.title },
          { daysQuiet: b.daysQuiet, valueCents: b.deal.valueCents, title: b.deal.title },
        ),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

export function useRecentActivity(limit = 20) {
  return useQuery({
    queryKey: [...qk.today(), "recent", limit] as const,
    queryFn: (): Promise<RecentEntry[]> => recentWithLinks(limit),
  });
}

// ---------------------------------------------------------------------------
// The connect-your-website card, and the first-run screen
// ---------------------------------------------------------------------------

export type ConnectCardState = {
  show: boolean;
  siteOrigin: string | null;
};

export function useConnectCard() {
  return useQuery({
    queryKey: [...qk.today(), "connect-card"] as const,
    queryFn: async (): Promise<ConnectCardState> => {
      const [siteOrigin, dismissed] = await Promise.all([
        settingsRepo.get("siteOrigin"),
        settingsRepo.get("connectCardDismissed"),
      ]);
      return { show: !siteOrigin && !dismissed, siteOrigin };
    },
  });
}

export function useWorkspaceIsEmpty() {
  return useQuery({
    queryKey: [...qk.today(), "empty"] as const,
    queryFn: workspaceIsEmpty,
  });
}

// ---------------------------------------------------------------------------
// The mutations Today's rows fire
// ---------------------------------------------------------------------------

/**
 * One invalidation helper, because every Today action can move rows between
 * sections: completing a task empties Due now and adds a system entry to
 * Recent activity; logging a call clears a New lead and a Gone quiet row at
 * once.
 */
function useInvalidateToday() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: qk.today() });
    void client.invalidateQueries({ queryKey: qk.tasks() });
    void client.invalidateQueries({ queryKey: qk.deals() });
    void client.invalidateQueries({ queryKey: qk.activities() });
  };
}

export function useCompleteTask() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: (id: string) => tasksRepo.complete(id),
    onSuccess: invalidate,
  });
}

export function useUncompleteTask() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: (id: string) => tasksRepo.uncomplete(id),
    onSuccess: invalidate,
  });
}

export function useSnoozeTask() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: (input: { id: string; when: "tomorrow" | "next-week" }) =>
      tasksRepo.snooze(input.id, input.when),
    onSuccess: invalidate,
  });
}

/** "Log a call" from a New leads or Gone quiet row. */
export function useLogCall() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: (input: {
      body: string;
      contactId?: string | null;
      companyId?: string | null;
      dealId?: string | null;
    }) =>
      activitiesRepo.create({
        kind: "call",
        body: input.body,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
      }),
    onSuccess: invalidate,
  });
}

/**
 * "Snooze a week" on a Gone quiet row.
 *
 * This writes a system activity rather than setting a snooze column. The rule
 * keys off the newest activity, so recording one is exactly what "I know, I'm
 * on it" means, and the trail stays honest: the timeline shows that the owner
 * deferred it, with a date.
 */
export function useSnoozeQuietDeal() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: (input: { dealId: string; limitDays: number }) =>
      activitiesRepo.createSystem({
        body: snoozeActivityBody(input.limitDays),
        dealId: input.dealId,
      }),
    onSuccess: invalidate,
  });
}

export function useDismissConnectCard() {
  const invalidate = useInvalidateToday();
  return useMutation({
    mutationFn: () => settingsRepo.set("connectCardDismissed", true),
    onSuccess: () => {
      invalidate();
    },
  });
}
