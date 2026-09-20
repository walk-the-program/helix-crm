/**
 * The persistent card that stands between a fresh workspace and a lost key
 * (LR-6, F-OPS-1's second half).
 *
 * `RecoveryKeyPanel` in Settings > Backups has done the reveal-and-save work
 * since LR-OPS, but a client may never open Settings, which made the whole
 * fix optional in practice. This card puts the same choice in front of every
 * owner, on the first screen they see, and does not let go until they have
 * actually kept a copy of the key.
 *
 * It is the one primary block on Today while it is showing (TodayScreen.tsx
 * hands "Import a CSV" the secondary treatment for exactly that reason), and
 * it owns no state that outlives it: the key lives inside
 * `RecoveryKeyControls`'s own `useState` and nowhere else, so closing or
 * confirming the card drops it for good. The reveal / display / copy / save /
 * print controls are the same shared component `RecoveryKeyPanel` in
 * BackupsScreen.tsx mounts (F-CS-1 A9) — this file adds only the explicit
 * confirm gate on top of it.
 *
 * A9: an owner who does the conscientious thing from Settings > Backups
 * instead (reveal, then copy/save/print there) has genuinely kept the key,
 * and `RecoveryKeyPanel` writes the same `recoveryKey.confirmedAt` this card
 * does. There is one truth, `shouldShowRecoveryKeyCard`, read from one
 * setting; this card is not the only door that can close it. An existing
 * workspace already in daily use — records and history, but
 * `recoveryKey.confirmedAt` never set — gets this card too, and that is
 * intended: nobody has shown that owner the key either.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, CardTitle, toast } from "@/ui";
import { qk } from "@/app/queryClient";
import * as settingsRepo from "@/db/repos/settings";
import { nowIso } from "@/lib/dates";
import { RecoveryKeyControls } from "@/features/data/backups/BackupsScreen";
import {
  RECOVERY_KEY_CONFIRMED_AT_KEY,
  canConfirmRecoveryKey,
  shouldShowRecoveryKeyCard,
} from "@/features/today/lib/recoveryKeyCard";

/**
 * Tauri rejects a command with a plain `{ code, message }` object rather than
 * an Error (the same trap BackupsScreen.tsx's own `messageFrom` exists for).
 */
function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function readConfirmedAt(): Promise<string | null> {
  const value = await settingsRepo.getRaw(RECOVERY_KEY_CONFIRMED_AT_KEY);
  return typeof value === "string" ? value : null;
}

/**
 * Whether the card should be on screen right now. TodayScreen uses this both
 * to decide whether to mount the card at all and to hand "Import a CSV" the
 * right treatment, so the two never disagree about which one owns the
 * screen's primary block.
 */
export function useShowRecoveryKeyCard(): boolean {
  const { data } = useQuery({
    queryKey: qk.setting(RECOVERY_KEY_CONFIRMED_AT_KEY),
    queryFn: readConfirmedAt,
  });
  // Undefined while the first read is in flight: treated as "not shown yet"
  // rather than flashing the card on for the instant before the real answer
  // arrives. The read is one row off local SQLite, so that instant is brief.
  if (data === undefined) return false;
  return shouldShowRecoveryKeyCard({ confirmedAt: data });
}

export function RecoveryKeyCard() {
  const queryClient = useQueryClient();

  const confirm = useMutation({
    mutationFn: () => settingsRepo.setRaw(RECOVERY_KEY_CONFIRMED_AT_KEY, nowIso()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.setting(RECOVERY_KEY_CONFIRMED_AT_KEY) });
      toast.success("Recovery key confirmed.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not save that you kept the key.")),
  });

  return (
    <Card className="mb-[var(--space-6)]">
      <CardHeader>
        <CardTitle>Save your recovery key</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        <p className="max-w-[var(--content-max)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Your data and your backups on this computer are locked with a key
          that stays on this computer. If this computer dies, is lost or is
          replaced, this key is the only way to open your backups on the next
          one. Nobody can send you a copy — not ClearPath, not anyone.
        </p>

        <RecoveryKeyControls
          footer={({ revealed, kept }) => (
            <Button
              type="button"
              variant="primary"
              disabled={!canConfirmRecoveryKey({ revealed: revealed !== null, kept })}
              onClick={() => confirm.mutate()}
              loading={confirm.isPending}
              loadingLabel="Saving…"
            >
              I have saved it
            </Button>
          )}
        />

        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Backups sit next to your data on this computer, and{" "}
          <Link href="/settings/backups">Settings → Backups</Link> can also
          copy them to a drive or a folder your computer already syncs.
        </p>
      </CardBody>
    </Card>
  );
}
