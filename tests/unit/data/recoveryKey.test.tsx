// @vitest-environment jsdom
/**
 * The recovery key, from the screen's side (LR-OPS, F-OPS-1).
 *
 * The Rust half - the format, the parser, adopting a backup on a machine with
 * an empty keychain, and every refusal leaving nothing behind - is proven in
 * `src-tauri/tests/recovery_tests.rs` and `src-tauri/src/recovery.rs`. This
 * file holds the two things only the frontend can get wrong:
 *
 *   1. the key is not on screen until the owner asks for it, and is gone again
 *      when they close the panel;
 *   2. a refused adopt shows the owner the reason Rust gave, not
 *      "[object Object]" - Tauri rejects with a plain `{ code, message }`
 *      object rather than an Error, which is the exact trap the lead poller
 *      fell into (F-LB-6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const revealRecoveryKey = vi.fn();
const saveRecoveryKeyFile = vi.fn();
const pickBackupFile = vi.fn();
const adoptBackup = vi.fn();
const switchWorkspace = vi.fn();

vi.mock("@/features/data/backups/recovery", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/data/backups/recovery")
  >("@/features/data/backups/recovery");
  return {
    ...actual,
    revealRecoveryKey: (...args: unknown[]) => revealRecoveryKey(...args),
    saveRecoveryKeyFile: (...args: unknown[]) => saveRecoveryKeyFile(...args),
    pickBackupFile: (...args: unknown[]) => pickBackupFile(...args),
    adoptBackup: (...args: unknown[]) => adoptBackup(...args),
  };
});

vi.mock("@/app/boot", () => ({
  switchWorkspace: (...args: unknown[]) => switchWorkspace(...args),
}));

import {
  OpenFromAnotherMachinePanel,
  RecoveryKeyPanel,
} from "@/features/data/backups/BackupsScreen";
import {
  recoveryKeyFileName,
  suggestedName,
} from "@/features/data/backups/recovery";

const KEY = "HLX1-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF";

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("recoveryKeyFileName", () => {
  it("slugs the workspace name and dates the file", () => {
    expect(recoveryKeyFileName("Mercer & Sons Landscaping", new Date("2026-09-20T11:00:00Z"))).toBe(
      "helix-recovery-key-mercer-sons-landscaping-2026-09-20.txt",
    );
  });

  it("never produces a name that is only dashes", () => {
    expect(recoveryKeyFileName("...", new Date("2026-09-20T11:00:00Z"))).toBe(
      "helix-recovery-key-workspace-2026-09-20.txt",
    );
  });
});

describe("suggestedName", () => {
  it("offers the backup's date, because its file name says nothing else useful", () => {
    expect(suggestedName("/x/backups/2026-09-18T19-05-03Z-scheduled.db")).toBe(
      "Restored from 2026-09-18",
    );
  });

  it("falls back when the file was renamed by hand", () => {
    expect(suggestedName("/x/old-mac-copy.db")).toBe("Restored workspace");
  });
});

describe("RecoveryKeyPanel", () => {
  it("shows nothing until the owner asks, and asks Rust only then", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    render(withQuery(<RecoveryKeyPanel />));

    expect(screen.queryByTestId("recovery-key")).toBeNull();
    expect(revealRecoveryKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));

    await waitFor(() => expect(screen.getByTestId("recovery-key").textContent).toBe(KEY));
    expect(revealRecoveryKey).toHaveBeenCalledTimes(1);
  });

  it("takes the key back off the screen when the owner hides it", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    render(withQuery(<RecoveryKeyPanel />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByTestId("recovery-key")).toBeNull());
  });

  it("saves the text Rust built, not a copy of it assembled here", async () => {
    const revealed = { key: KEY, fileText: "Helix CRM recovery key\n..." };
    revealRecoveryKey.mockResolvedValue(revealed);
    saveRecoveryKeyFile.mockResolvedValue("/Users/x/Desktop/key.txt");
    render(withQuery(<RecoveryKeyPanel />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Save to a file" }));
    await waitFor(() => expect(saveRecoveryKeyFile).toHaveBeenCalledWith(revealed));
    await waitFor(() =>
      expect(screen.getByText("Saved to /Users/x/Desktop/key.txt")).toBeTruthy(),
    );
  });
});

describe("OpenFromAnotherMachinePanel", () => {
  it("will not try until there is both a file and a key", async () => {
    render(withQuery(<OpenFromAnotherMachinePanel />));
    const open = screen.getByRole("button", { name: "Open this backup" });
    expect((open as HTMLButtonElement).disabled).toBe(true);

    pickBackupFile.mockResolvedValue("/x/backups/2026-09-18T19-05-03Z-scheduled.db");
    fireEvent.click(screen.getByRole("button", { name: "Choose a backup file" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Restored from 2026-09-18")).toBeTruthy(),
    );
    expect((screen.getByRole("button", { name: "Open this backup" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText("Recovery key"), { target: { value: KEY } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Open this backup" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("shows the reason Rust gave for a refusal, not [object Object]", async () => {
    pickBackupFile.mockResolvedValue("/x/backups/2026-09-18T19-05-03Z-scheduled.db");
    // Exactly the shape a Tauri command rejects with.
    adoptBackup.mockRejectedValue({
      code: "DB_OPEN_FAILED",
      message: "That recovery key does not open this file.",
    });
    render(withQuery(<OpenFromAnotherMachinePanel />));

    fireEvent.click(screen.getByRole("button", { name: "Choose a backup file" }));
    await waitFor(() => expect(screen.getByDisplayValue("Restored from 2026-09-18")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Recovery key"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Open this backup" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That recovery key does not open this file.");
    expect(alert.textContent).not.toContain("object Object");
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("opens the adopted workspace when the key is right", async () => {
    pickBackupFile.mockResolvedValue("/x/backups/2026-09-18T19-05-03Z-scheduled.db");
    adoptBackup.mockResolvedValue({
      id: "018f-new",
      name: "Restored from 2026-09-18",
      path: "/x/workspaces/018f-new/helix.db",
      lastPolledAt: null,
      lastBackupAt: null,
      archived: false,
    });
    switchWorkspace.mockResolvedValue({});
    render(withQuery(<OpenFromAnotherMachinePanel />));

    fireEvent.click(screen.getByRole("button", { name: "Choose a backup file" }));
    await waitFor(() => expect(screen.getByDisplayValue("Restored from 2026-09-18")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Recovery key"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Open this backup" }));

    await waitFor(() =>
      expect(adoptBackup).toHaveBeenCalledWith(
        "/x/backups/2026-09-18T19-05-03Z-scheduled.db",
        KEY,
        "Restored from 2026-09-18",
      ),
    );
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledTimes(1));
    // The form clears, so a second recovery does not reuse the first one's key.
    await waitFor(() => expect(screen.getByLabelText("Recovery key")).toHaveProperty("value", ""));
  });
});
