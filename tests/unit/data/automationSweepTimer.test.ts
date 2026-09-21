/**
 * The daily follow-up sweep's beat (LR-OPS-RECHECK, F-OPS-R-1 and F-OPS-R-2).
 *
 * The rules are the ones every background job in this product follows, and
 * they are tested here rather than assumed because the sweep is the newest one
 * and was the only one that had none of them: it ran once at boot and nothing
 * ever scheduled it again.
 *
 * What the sweep DOES - which invoices are overdue, and that a second run
 * creates no second task - belongs to `automations.ts` and Lead C's tests.
 * This file is only about when it is allowed to run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const automationSweep = vi.fn();
const onDocumentStatusChanged = vi.fn((..._args: unknown[]) => () => {});
let paused = false;

vi.mock("@/db/repos/automations", () => ({
  automationSweep: (...a: unknown[]) => automationSweep(...a),
  runQuoteSent: vi.fn(),
}));
vi.mock("@/db/repos/documents", () => ({
  onDocumentStatusChanged: (...a: unknown[]) => onDocumentStatusChanged(...a),
}));
vi.mock("@/db/client", () => ({ raw: { batch: vi.fn() } }));
vi.mock("@/db/writeLock", () => ({ timersPaused: () => paused }));

import {
  AUTOMATION_SWEEP_INTERVAL_MS,
  startAutomations,
  stopAutomations,
  tick,
} from "@/features/settings/lib/automationBoot";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  paused = false;
  automationSweep.mockResolvedValue(0);
});

afterEach(() => {
  stopAutomations();
  vi.useRealTimers();
});

describe("the daily follow-up sweep's beat", () => {
  /**
   * The finding this file exists for. An owner who shuts the lid instead of
   * quitting used to get one sweep on install day and none after it, while
   * Settings went on calling it the daily follow-up.
   */
  it("runs again a day later without the app being relaunched", async () => {
    await startAutomations();
    expect(automationSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS);
    expect(automationSweep).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS);
    expect(automationSweep).toHaveBeenCalledTimes(3);
  });

  it("does not run twice a day", async () => {
    await startAutomations();
    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS - 1000);
    expect(automationSweep).toHaveBeenCalledTimes(1);
  });

  /**
   * An import or a restore holds the write lock and pauses the timers. The
   * sweep would only ever queue behind it - since F-OPS-12 there is no way to
   * join somebody else's transaction - but queueing a few hundred task inserts
   * behind a 100k-row import is still wrong for a job whose next chance is
   * tomorrow.
   */
  it("skips while an import or a restore holds the write lock, and comes back in a minute", async () => {
    paused = true;
    await startAutomations();
    expect(automationSweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(automationSweep, "still paused").not.toHaveBeenCalled();

    paused = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(automationSweep, "the import finished, so the next look sweeps").toHaveBeenCalledTimes(1);
  });

  it("never overlaps itself: a slow sweep is not re-entered", async () => {
    let release: () => void = () => {};
    automationSweep.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );

    const first = startAutomations();
    await Promise.resolve();
    expect(automationSweep).toHaveBeenCalledTimes(1);

    // A second entry into the beat while the first is still running.
    void tick();
    await Promise.resolve();
    expect(automationSweep, "the guard held").toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  /** A sweep that throws must not stop the beat, and must not reach the boot path. */
  it("keeps the beat after a sweep throws", async () => {
    automationSweep.mockRejectedValueOnce(new Error("no such table: automations"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(startAutomations()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();

    automationSweep.mockResolvedValue(0);
    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS);
    expect(automationSweep, "tomorrow's sweep still happens").toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("registers one listener and keeps one timer however often it is started", async () => {
    await startAutomations();
    await startAutomations();
    await startAutomations();
    expect(onDocumentStatusChanged).toHaveBeenCalledTimes(1);
    expect(automationSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS);
    expect(automationSweep, "one beat, not three").toHaveBeenCalledTimes(2);
  });

  it("stops completely when told to", async () => {
    await startAutomations();
    stopAutomations();

    await vi.advanceTimersByTimeAsync(AUTOMATION_SWEEP_INTERVAL_MS * 3);
    expect(automationSweep).toHaveBeenCalledTimes(1);
  });
});
