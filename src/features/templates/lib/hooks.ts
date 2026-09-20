/**
 * Message templates: the feature's own data layer.
 *
 * `src/app/queryClient.ts` has no "templates" key, so this file owns its own
 * query keys, the same way `src/features/recurring/lib/hooks.ts` owns `rk`.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import * as templatesRepo from "@/db/repos/templates";
import { toast } from "@/ui";
import type { NewTemplate, Template, TemplateKind, TemplatePatch } from "@/db/repos/templates";

export const tk = {
  all: () => ["templates"] as const,
  list: (kind?: string) => ["templates", "list", kind ?? null] as const,
};

export async function invalidateTemplates(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: tk.all() });
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every live template, or every live template of one kind.
 *
 * `ensureStarters()` runs inside the query function itself. It is idempotent —
 * it counts the whole table, soft-deleted rows included, and returns 0 the
 * moment anything exists — so calling it on every read costs nothing after the
 * first visit, and it is what makes "seed four sensible templates per
 * workspace on first use" happen without a separate migration or boot step.
 */
export function useTemplates(kind?: TemplateKind) {
  return useQuery({
    queryKey: tk.list(kind),
    queryFn: async (): Promise<Template[]> => {
      await templatesRepo.ensureStarters();
      return templatesRepo.list({ kind });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export function useCreateTemplate() {
  return useMutation({
    mutationFn: (input: NewTemplate): Promise<Template> => templatesRepo.create(input),
    onSuccess: invalidateTemplates,
  });
}

export function useUpdateTemplate() {
  return useMutation({
    mutationFn: (input: { id: string; patch: TemplatePatch }): Promise<Template> =>
      templatesRepo.update(input.id, input.patch),
    onSuccess: invalidateTemplates,
  });
}

export function useReorderTemplates() {
  return useMutation({
    mutationFn: (orderedIds: string[]): Promise<void> => templatesRepo.reorder(orderedIds),
    onSuccess: invalidateTemplates,
  });
}

/** Soft delete with ten seconds of Undo, the same contract as everywhere else. */
export function useDeleteTemplate() {
  return useMutation({
    mutationFn: async (template: Template): Promise<void> => {
      await templatesRepo.softDelete(template.id);
      await invalidateTemplates();
      toast.undo(`Deleted "${template.name}"`, () => {
        void (async () => {
          try {
            await templatesRepo.restore(template.id);
            await invalidateTemplates();
            toast.success(`Restored "${template.name}"`);
          } catch {
            toast.error(`Could not restore "${template.name}".`);
          }
        })();
      });
    },
  });
}
