// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { invalidateQueries, success } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  success: vi.fn(),
}));
vi.mock("@/app/queryClient", () => ({ queryClient: { invalidateQueries } }));
vi.mock("sonner", () => ({ toast: { success } }));

import { refreshAll, refreshCommands, useRefreshOnNavigate, REFRESH_SHORTCUT } from "@/app/refresh";
import { queryClient } from "@/app/queryClient";

beforeEach(() => {
  invalidateQueries.mockClear();
  success.mockClear();
});

describe("refresh", () => {
  it("the Refresh command invalidates every query and says so", async () => {
    const command = refreshCommands.find((c) => c.id === "refresh");
    expect(command?.shortcut).toBe(REFRESH_SHORTCUT);
    expect(command?.group).toBe("View");
    await command!.run();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith();
    expect(success).toHaveBeenCalledWith("Refreshed.");
  });

  it("refreshAll without announce is silent", async () => {
    await refreshAll();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it("navigating to another route invalidates; the first render does not", () => {
    const { rerender } = renderHook(({ loc }: { loc: string }) => useRefreshOnNavigate(loc), {
      initialProps: { loc: "/" },
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
    rerender({ loc: "/contacts" });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    rerender({ loc: "/contacts" });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    rerender({ loc: "/deals" });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});

describe("query defaults", () => {
  it("nothing is treated as fresh for long, and focus refetches", async () => {
    vi.doUnmock("@/app/queryClient");
    vi.resetModules();
    const real = await import("@/app/queryClient");
    const defaults = real.queryClient.getDefaultOptions().queries!;
    expect(defaults.staleTime).toBe(0);
    expect(defaults.refetchOnWindowFocus).toBe(true);
    void queryClient;
  });
});
