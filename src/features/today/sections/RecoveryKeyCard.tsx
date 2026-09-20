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
 * it owns no state that outlives it: the key lives in this component's own
 * `useState` and nowhere else, so closing or confirming the card drops it for
 * good. Nothing here is new key material or a new save path — `reveal` and
 * `save` are the same `revealRecoveryKey`/`saveRecoveryKeyFile` the Backups
 * screen calls; only copy, print and the confirm gate are new.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button, Card, CardBody, CardHeader, CardTitle, toast } from "@/ui";
import { qk } from "@/app/queryClient";
import * as settingsRepo from "@/db/repos/settings";
import { nowIso } from "@/lib/dates";
import {
  revealRecoveryKey,
  saveRecoveryKeyFile,
  type RevealedKey,
} from "@/features/data/backups/recovery";
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

/**
 * The print-only block plus the CSS that hides everything else on the page
 * while printing.
 *
 * There is no separate print stylesheet to add a rule to that this feature
 * owns, so the rule ships with the component: `visibility: hidden` on every
 * element, overridden back to `visible` on this block and its children. That
 * works regardless of how deep the block sits in the tree — unlike `display`,
 * a descendant's `visibility` isn't forced by an ancestor's — so the sidebar
 * and the rest of Today never show up on the page.
 */
function PrintableKey({ revealed }: { revealed: RevealedKey }) {
  return (
    <div className="helix-recovery-print hidden">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .helix-recovery-print, .helix-recovery-print * { visibility: visible; }
          .helix-recovery-print {
            display: block !important;
            position: fixed;
            inset: 0;
            white-space: pre-wrap;
          }
        }
      `}</style>
      {revealed.fileText}
    </div>
  );
}

export function RecoveryKeyCard() {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);

  const kept = copied || savedTo !== null || printed;
  const canConfirm = canConfirmRecoveryKey({ revealed: revealed !== null, kept });

  const reveal = useMutation({
    mutationFn: () => revealRecoveryKey(),
    onSuccess: (key) => setRevealed(key),
    onError: (err: unknown) =>
      toast.error(
        messageFrom(err, "Helix could not read this workspace's recovery key."),
      ),
  });

  const copy = useMutation({
    mutationFn: async () => {
      if (!revealed) return;
      await navigator.clipboard.writeText(revealed.key);
    },
    onSuccess: () => {
      setCopied(true);
      toast.success("Recovery key copied.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not copy the recovery key.")),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!revealed) return null;
      return saveRecoveryKeyFile(revealed);
    },
    onSuccess: (path) => {
      if (path === null) return; // the owner closed the dialog
      setSavedTo(path);
      toast.success("Recovery key saved.");
    },
    onError: (err: unknown) =>
      toast.error(messageFrom(err, "Helix could not save the recovery key.")),
  });

  const canPrint = typeof window !== "undefined" && typeof window.print === "function";

  const print = () => {
    setPrinted(true);
    window.print();
  };

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

        {revealed === null ? (
          <div>
            <Button
              type="button"
              variant="primary"
              onClick={() => reveal.mutate()}
              loading={reveal.isPending}
              loadingLabel="Reading the key…"
            >
              Show recovery key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-3)]">
            <code
              data-testid="today-recovery-key"
              className={[
                "block select-all break-all",
                "border border-[var(--color-border-strong)]",
                "bg-[var(--color-bg)] px-[var(--space-3)] py-[var(--space-3)]",
                "font-[family-name:var(--font-mono)] text-[length:var(--text-sm)]",
                "leading-[var(--leading-normal)] tabular-nums text-[var(--color-text)]",
              ].join(" ")}
            >
              {revealed.key}
            </code>
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Keep it away from this computer and away from your backups.
              Anyone who has both can read everything in your CRM.
            </p>
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <Button
                type="button"
                variant="secondary"
                onClick={() => copy.mutate()}
                loading={copy.isPending}
                loadingLabel="Copying…"
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => save.mutate()}
                loading={save.isPending}
                loadingLabel="Saving…"
              >
                Save to a file
              </Button>
              {canPrint ? (
                <Button type="button" variant="secondary" onClick={print}>
                  Print
                </Button>
              ) : null}
            </div>
            {savedTo ? (
              <p
                title={savedTo}
                className="truncate text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
              >
                Saved to {savedTo}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                variant="primary"
                disabled={!canConfirm}
                onClick={() => confirm.mutate()}
                loading={confirm.isPending}
                loadingLabel="Saving…"
              >
                I have saved it
              </Button>
            </div>
            <PrintableKey revealed={revealed} />
          </div>
        )}

        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Backups sit next to your data on this computer, and{" "}
          <Link href="/settings/backups">Settings → Backups</Link> can also
          copy them to a drive or a folder your computer already syncs.
        </p>
      </CardBody>
    </Card>
  );
}
