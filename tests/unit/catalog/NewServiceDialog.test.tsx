/**
 * `NewServiceDialog`'s save path: the contract R3-L3 (invoices) is waiting
 * on. It has to save a real catalog row through `useCreateService` (so the
 * catalog query cache stays correct), hand that row back through `onCreated`,
 * and close itself - and it has to refuse to do any of that when the name or
 * the price is missing.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installRadixStubs } from "../ui/radixSetup";
import { NewServiceDialog } from "@/features/catalog/components/NewServiceDialog";
import type { Product } from "@/db/repos/products";

installRadixStubs();

const CREATED: Product = {
  id: "prod-1",
  name: "Gutter cleaning",
  description: null,
  kind: "one_time",
  interval: null,
  unitPriceCents: 15000,
  taxable: false,
  active: true,
  position: 0,
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
  deletedAt: null,
};

const createMock = vi.fn(async (_input: unknown) => CREATED);

vi.mock("@/db/repos/products", async () => {
  const actual = await vi.importActual<typeof import("@/db/repos/products")>(
    "@/db/repos/products",
  );
  return { ...actual, create: (input: unknown) => createMock(input) };
});

afterEach(() => {
  cleanup();
  createMock.mockClear();
});

function renderDialog(overrides: { initialName?: string } = {}) {
  const client = new QueryClient();
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NewServiceDialog
        open
        onOpenChange={onOpenChange}
        initialName={overrides.initialName}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

describe("NewServiceDialog: saving", () => {
  it("creates a catalog row through useCreateService, hands it back, and closes", async () => {
    const user = userEvent.setup();
    const { onCreated, onOpenChange } = renderDialog();

    await user.type(screen.getByTestId("new-service-name-input"), "Gutter cleaning");
    await user.type(screen.getByTestId("new-service-price-input"), "150");
    await user.click(screen.getByTestId("new-service-save"));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        name: "Gutter cleaning",
        kind: "one_time",
        interval: null,
        unitPriceCents: 15000,
        taxable: false,
      });
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("translates the charge choice to kind and interval", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId("new-service-name-input"), "Lawn plan");
    await user.type(screen.getByTestId("new-service-price-input"), "80");
    await user.selectOptions(
      screen.getByLabelText("How is it charged?"),
      "Every year",
    );
    await user.click(screen.getByTestId("new-service-save"));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "recurring", interval: "year" }),
      );
    });
  });

  it("refuses to save with no name, and never calls create", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.type(screen.getByTestId("new-service-price-input"), "150");
    await user.click(screen.getByTestId("new-service-save"));

    await screen.findByText("Give the service a name you will recognise.");
    expect(createMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("refuses to save with no price", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByTestId("new-service-name-input"), "Gutter cleaning");
    await user.click(screen.getByTestId("new-service-save"));

    await screen.findByText("Enter an amount, for example 150.");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("prefills the name from initialName", () => {
    renderDialog({ initialName: "Mulch delivery" });
    const input = screen.getByTestId("new-service-name-input") as HTMLInputElement;
    expect(input.value).toBe("Mulch delivery");
  });
});
