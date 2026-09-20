// @vitest-environment jsdom
/**
 * Today's recovery-key card (LR-6, F-OPS-1's second half): the two things
 * only a render can prove.
 *
 *   1. the key is not in the DOM until the owner presses "Show recovery
 *      key", and Rust is asked for it only then (A4);
 *   2. "I have saved it" stays disabled until the key has been revealed AND
 *      at least one of copy / save / print has succeeded (A2).
 *
 * The gating rule itself (`shouldShowRecoveryKeyCard` /
 * `canConfirmRecoveryKey`) is proven without a render in
 * recoveryKeyCardGate.test.ts; this file proves the component actually wires
 * that rule up rather than reimplementing it inline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

const revealRecoveryKey = vi.fn();
const saveRecoveryKeyFile = vi.fn();

vi.mock("@/features/data/backups/recovery", () => ({
  revealRecoveryKey: (...args: unknown[]) => revealRecoveryKey(...args),
  saveRecoveryKeyFile: (...args: unknown[]) => saveRecoveryKeyFile(...args),
}));

const getRaw = vi.fn();
const setRaw = vi.fn();

vi.mock("@/db/repos/settings", () => ({
  getRaw: (...args: unknown[]) => getRaw(...args),
  setRaw: (...args: unknown[]) => setRaw(...args),
}));

// RecoveryKeyCard now mounts BackupsScreen.tsx's shared RecoveryKeyControls
// (F-CS-1 A9), which also imports @/app/boot; mocked the same way
// tests/unit/data/recoveryKey.test.tsx already mocks it, so importing that
// module here does not need a real Tauri runtime behind it.
vi.mock("@/app/boot", () => ({
  switchWorkspace: vi.fn(),
}));

import { RecoveryKeyCard, useShowRecoveryKeyCard } from "@/features/today/sections/RecoveryKeyCard";
import { RecoveryKeyPanel } from "@/features/data/backups/BackupsScreen";

const KEY =
  "HLX1-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF";

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function queryWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stubClipboard(): void {
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecoveryKeyCard", () => {
  it("shows nothing until the owner asks, and asks Rust only then", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    render(withQuery(<RecoveryKeyCard />));

    expect(screen.queryByTestId("recovery-key")).toBeNull();
    expect(revealRecoveryKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));

    await waitFor(() => expect(screen.getByTestId("recovery-key").textContent).toBe(KEY));
    expect(revealRecoveryKey).toHaveBeenCalledTimes(1);
  });

  it("does not offer the confirm control before the key has been revealed", () => {
    render(withQuery(<RecoveryKeyCard />));
    expect(screen.queryByRole("button", { name: "I have saved it" })).toBeNull();
  });

  it("keeps the confirm control disabled after reveal until a copy is kept, then enables it", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    stubClipboard();
    render(withQuery(<RecoveryKeyCard />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());

    const confirm = () => screen.getByRole("button", { name: "I have saved it" }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(confirm().disabled).toBe(false));
  });

  it("also unlocks confirm on a successful save, without needing copy too", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    saveRecoveryKeyFile.mockResolvedValue("/Users/x/Desktop/key.txt");
    render(withQuery(<RecoveryKeyCard />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());

    const confirm = () => screen.getByRole("button", { name: "I have saved it" }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save to a file" }));
    await waitFor(() => expect(confirm().disabled).toBe(false));
  });

  it("a save the owner cancelled does not count as kept", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    saveRecoveryKeyFile.mockResolvedValue(null); // the owner closed the dialog
    render(withQuery(<RecoveryKeyCard />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save to a file" }));

    await waitFor(() => expect(saveRecoveryKeyFile).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByRole("button", { name: "I have saved it" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("writes recoveryKey.confirmedAt once the owner confirms", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    stubClipboard();
    setRaw.mockResolvedValue(undefined);
    render(withQuery(<RecoveryKeyCard />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "I have saved it" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    await waitFor(() =>
      expect(setRaw).toHaveBeenCalledWith("recoveryKey.confirmedAt", expect.any(String)),
    );
  });

  it("does not offer Print when window.print is not a function", async () => {
    const original = window.print;
    // @ts-expect-error -- simulating a host with no print handler
    delete window.print;
    try {
      revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
      render(withQuery(<RecoveryKeyCard />));
      fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
      await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
      expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    } finally {
      window.print = original;
    }
  });

  it("offers a link to Settings > Backups for the second copy, while the card is showing", () => {
    render(withQuery(<RecoveryKeyCard />));
    const link = screen.getByRole("link", { name: "Settings → Backups" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings/backups");
  });
});

describe("RecoveryKeyPanel (Settings > Backups) also clears the Today card's condition (F-CS-1 A9)", () => {
  it("writes recoveryKey.confirmedAt on a successful save, the same key Today's card reads", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    saveRecoveryKeyFile.mockResolvedValue("/Users/x/Desktop/key.txt");
    render(withQuery(<RecoveryKeyPanel />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save to a file" }));

    // An owner who did the conscientious thing here has kept the key: the
    // panel writes the confirmation itself, with no separate confirm click,
    // because a workspace where this already happened must not still show
    // Today's card (there is one truth, read from one setting).
    await waitFor(() =>
      expect(setRaw).toHaveBeenCalledWith("recoveryKey.confirmedAt", expect.any(String)),
    );
  });

  it("writes it on a successful copy too, not only on save", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    stubClipboard();
    render(withQuery(<RecoveryKeyPanel />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(setRaw).toHaveBeenCalledWith("recoveryKey.confirmedAt", expect.any(String)),
    );
  });

  it("does not write anything on a mere reveal, or on a save the owner cancelled", async () => {
    revealRecoveryKey.mockResolvedValue({ key: KEY, fileText: "..." });
    saveRecoveryKeyFile.mockResolvedValue(null); // the owner closed the dialog
    render(withQuery(<RecoveryKeyPanel />));

    fireEvent.click(screen.getByRole("button", { name: "Show recovery key" }));
    await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
    expect(setRaw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save to a file" }));
    await waitFor(() => expect(saveRecoveryKeyFile).toHaveBeenCalledTimes(1));
    expect(setRaw).not.toHaveBeenCalled();
  });
});

describe("useShowRecoveryKeyCard", () => {
  it("is true for a workspace that has never confirmed the key", async () => {
    getRaw.mockResolvedValue(null);
    const { result } = renderHook(() => useShowRecoveryKeyCard(), { wrapper: queryWrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is false once a confirmation timestamp is stored", async () => {
    getRaw.mockResolvedValue("2026-09-20T12:00:00.000Z");
    const { result } = renderHook(() => useShowRecoveryKeyCard(), { wrapper: queryWrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
