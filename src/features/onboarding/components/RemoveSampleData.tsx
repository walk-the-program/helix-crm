/**
 * "Remove sample data" — the button, and the confirm behind it.
 *
 * The button draws nothing at all when there is no sample data, which is why it
 * is safe to mount unconditionally: Settings' Workspace section and Today's
 * first-run card can both hold one and neither has to know whether the example
 * was ever loaded.
 *
 * Removing the example is a purge, not a soft delete, so it asks first — the one
 * rule docs/DESIGN.md §2 puts on a destructive action. The confirm dialog lives
 * in `SampleDataHost`, which the feature mounts through the shell's `overlays`
 * slot, so the "remove-sample-data" command can open it from a screen that has
 * no button on it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, toast } from "@/ui";
import { qk } from "@/app/queryClient";
import { KEYS, readSampleLoadedAt } from "@/features/onboarding/lib/settings";
import { removeSampleData } from "@/features/onboarding/lib/sampleData";

const OPEN_EVENT = "helix:remove-sample-data";

/** Ask the mounted host to put the confirm up. Safe to call from anywhere. */
export function openRemoveSampleData(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * True when the example set is in this workspace.
 *
 * Exported because a caller sometimes has to know before it draws anything
 * around the button: Settings' Workspace screen puts the button inside a
 * grouped list with a label above it, and a label over a button that renders
 * nothing is an empty box. The button itself still checks for itself, so a
 * caller that does not care can mount it and forget it.
 */
export function useHasSampleData(): boolean {
  const { data } = useQuery({
    queryKey: qk.setting(KEYS.sampleLoadedAt),
    queryFn: () => readSampleLoadedAt(),
  });
  return Boolean(data);
}

/**
 * Mounted wherever the owner might go looking for it. Renders nothing unless
 * the example is actually in the workspace.
 */
export function RemoveSampleDataButton({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  const loaded = useHasSampleData();
  if (!loaded) return null;
  return (
    <Button variant="destructive" size={size} onClick={openRemoveSampleData}>
      Remove sample data
    </Button>
  );
}

/** The confirm, mounted once per app through the feature's `overlays` slot. */
export function SampleDataHost() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const remove = useMutation({
    mutationFn: () => removeSampleData(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      toast.success(
        result.removed === 0
          ? "There was no sample data left to remove."
          : `Removed ${result.removed} sample records.`,
      );
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "The sample data did not come out. Nothing changed.",
      );
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Remove the sample data?"
      description="Every example customer, job, note and task goes for good. Anything you added yourself stays exactly where it is."
      confirmLabel="Remove it"
      cancelLabel="Keep it"
      destructive
      onConfirm={async () => {
        await remove.mutateAsync();
      }}
    />
  );
}

/**
 * The line that says, wherever the owner is looking, that some of what is on
 * the screen is the example set rather than his own work.
 *
 * It began as a private component on Today. It is here now because Today was
 * not the screen where the confusion happened: a sample job on the jobs board
 * is a card with a real customer's name, a real price and a real next step,
 * and nothing on that card says it was invented. Every sample row carries the
 * Sample tag, which the contacts list shows and a board card deliberately does
 * not (a card is four things and no more, DESIGN.md section 3) - so the honest
 * fix is to mark the screen rather than to put a fifth thing on every card.
 *
 * It draws nothing at all when the example set is not in this workspace, which
 * is what makes it safe to mount anywhere.
 */
export function SampleDataNote({ className }: { className?: string }) {
  const hasSampleData = useHasSampleData();
  if (!hasSampleData) return null;
  return (
    <div
      data-testid="sample-data-note"
      className={[
        "flex flex-wrap items-center gap-[var(--space-3)]",
        "border-t border-[var(--color-border)] pt-[var(--space-4)]",
        className ?? "mt-[var(--space-6)]",
      ].join(" ")}
    >
      <p className="flex-1 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Some of what you can see is the example Helix put in so the screens had
        something on them. Take it out whenever you like; your own records stay.
      </p>
      <RemoveSampleDataButton size="sm" />
    </div>
  );
}
