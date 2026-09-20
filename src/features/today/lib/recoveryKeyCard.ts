/**
 * The gating rules for Today's recovery-key card (LR-6, F-OPS-1's second
 * half).
 *
 * `RecoveryKeyPanel` in Settings > Backups has held the reveal/save controls
 * since LR-OPS, but a screen under Settings a client may never open cannot be
 * the thing standing between a fresh workspace and a lost key. This card is
 * the enforcement: it sits above everything else on Today until the owner has
 * actually seen the key and kept a copy of it, and it never comes back once
 * they have.
 *
 * Both rules are pure and hold no state of their own on purpose — the card
 * component is the only place that touches the database or the DOM, and this
 * file is what makes its two decisions testable without rendering anything.
 */

/** The setting this card reads and writes. Registered in src/db/repos/settings.ts. */
export const RECOVERY_KEY_CONFIRMED_AT_KEY = "recoveryKey.confirmedAt";

/**
 * Show the card until the owner has confirmed the key is kept, and never
 * again after. There is no dismiss, no snooze and no re-prompt: once
 * `confirmedAt` is set, this returns false forever.
 */
export function shouldShowRecoveryKeyCard(state: { confirmedAt: string | null }): boolean {
  return state.confirmedAt === null;
}

/**
 * The confirm control only unlocks once the key has actually been read AND at
 * least one of copy / save / print has succeeded. Revealing it and walking
 * away is not "saved it" — the owner has to have done something with it.
 */
export function canConfirmRecoveryKey(state: { revealed: boolean; kept: boolean }): boolean {
  return state.revealed && state.kept;
}
