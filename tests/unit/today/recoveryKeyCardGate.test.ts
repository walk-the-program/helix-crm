/**
 * The two pure rules behind Today's recovery-key card (LR-6): when it shows,
 * and when its confirm control unlocks. Both are asserted here with no
 * database and no render, which is the point of pulling them out of the
 * component in the first place.
 */
import { describe, expect, it } from "vitest";
import {
  canConfirmRecoveryKey,
  shouldShowRecoveryKeyCard,
} from "../../../src/features/today/lib/recoveryKeyCard";

describe("shouldShowRecoveryKeyCard", () => {
  it("shows the card when the key has never been confirmed", () => {
    expect(shouldShowRecoveryKeyCard({ confirmedAt: null })).toBe(true);
  });

  it("hides the card forever once a confirmation timestamp is stored", () => {
    expect(shouldShowRecoveryKeyCard({ confirmedAt: "2026-09-20T12:00:00.000Z" })).toBe(false);
  });
});

describe("canConfirmRecoveryKey", () => {
  it("is false before the key has been revealed, even if something was kept", () => {
    // Not reachable through the UI (nothing to keep before reveal), but the
    // rule itself must not depend on the caller getting the order right.
    expect(canConfirmRecoveryKey({ revealed: false, kept: true })).toBe(false);
  });

  it("is false once revealed but before anything has been kept", () => {
    expect(canConfirmRecoveryKey({ revealed: true, kept: false })).toBe(false);
  });

  it("is false when neither has happened", () => {
    expect(canConfirmRecoveryKey({ revealed: false, kept: false })).toBe(false);
  });

  it("is true only once the key is revealed AND at least one way of keeping it succeeded", () => {
    expect(canConfirmRecoveryKey({ revealed: true, kept: true })).toBe(true);
  });
});
