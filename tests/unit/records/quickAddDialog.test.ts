// @vitest-environment jsdom
/**
 * QuickAddDialog's save guard (F-LA-1) and post-save navigation (F-LA-6a).
 *
 * Written with createElement rather than JSX because vitest.config.ts
 * collects tests/unit/**\/*.test.ts only, same convention as
 * taskComposer.test.ts next to this file.
 *
 * Only the "contact" and "company" types are exercised by rendering: "deal"
 * pulls in StagePicker/ContactPicker/CompanyPicker (pipeline + stage
 * queries, a Combobox search), and "task"/"note" are exercised for the
 * "does not navigate" half of F-LA-6a without needing a full contact/company
 * pick through the Combobox. The guard and the finish()/navigate() call are
 * both in one shared function regardless of type, so contact + company +
 * task coverage exercises every branch the packet's acceptance criteria
 * name.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installRadixStubs } from "../ui/radixSetup";
import {
  __resetQuickAddForTests,
  openQuickAdd,
} from "@/features/records/quickAdd/store";

installRadixStubs();

const navigateMock = vi.fn();
vi.mock("wouter/use-browser-location", () => ({
  navigate: (...args: unknown[]) => navigateMock(...args),
}));

const createContact = vi.fn();
vi.mock("@/db/repos/contacts", async () => {
  const actual =
    await vi.importActual<typeof import("@/db/repos/contacts")>("@/db/repos/contacts");
  return {
    ...actual,
    create: (...args: unknown[]) => createContact(...args),
    findDuplicates: vi.fn().mockResolvedValue([]),
  };
});

const createCompany = vi.fn();
vi.mock("@/db/repos/companies", async () => {
  const actual =
    await vi.importActual<typeof import("@/db/repos/companies")>("@/db/repos/companies");
  return { ...actual, create: (...args: unknown[]) => createCompany(...args) };
});

const createTask = vi.fn();
vi.mock("@/db/repos/tasks", async () => {
  const actual = await vi.importActual<typeof import("@/db/repos/tasks")>("@/db/repos/tasks");
  return { ...actual, create: (...args: unknown[]) => createTask(...args) };
});

vi.mock("@/db/repos/pipelines", () => ({
  getDefault: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/db/repos/stages", () => ({
  list: vi.fn().mockResolvedValue([]),
}));

const invalidateRecordsMock = vi.fn().mockResolvedValue(undefined);
const offerUndoCreateMock = vi.fn();
const reportErrorMock = vi.fn();
vi.mock("@/features/records/lib/mutations", () => ({
  invalidateRecords: () => invalidateRecordsMock(),
  offerUndoCreate: (...args: unknown[]) => offerUndoCreateMock(...args),
  reportError: (...args: unknown[]) => reportErrorMock(...args),
  newBatchId: () => "batch-1",
}));

import { QuickAddDialog } from "@/features/records/quickAdd/QuickAddDialog";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client }, createElement(QuickAddDialog)));
}

afterEach(() => {
  cleanup();
  __resetQuickAddForTests();
  vi.clearAllMocks();
});

describe("QuickAddDialog: save guard (F-LA-1)", () => {
  it("two Enter presses in quick succession create exactly one record", async () => {
    createContact.mockResolvedValue({ id: "c1", firstName: "Brent", lastName: "Hendrickson" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Brent Hendrickson");
    fireEvent.change(nameInput, { target: { value: "Brent Hendrickson" } });

    // Two keydowns with no await between them: the second must land before
    // React has committed the first save's state.
    fireEvent.keyDown(nameInput, { key: "Enter" });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));
  });

  it("clicking Save then pressing Enter before the dialog closes creates one row", async () => {
    createContact.mockResolvedValue({ id: "c1", firstName: "Brent", lastName: "Hendrickson" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Brent Hendrickson");
    fireEvent.change(nameInput, { target: { value: "Brent Hendrickson" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));
  });

  it("Save and add another (Shift+Enter) clears the guard so the next entry saves", async () => {
    createContact
      .mockResolvedValueOnce({ id: "c1", firstName: "Brent", lastName: "One" })
      .mockResolvedValueOnce({ id: "c2", firstName: "Dana", lastName: "Two" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = (await screen.findByPlaceholderText(
      "Brent Hendrickson",
    )) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Brent One" } });
    fireEvent.keyDown(nameInput, { key: "Enter", shiftKey: true });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nameInput.value).toBe(""));
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: "Dana Two" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(2));
  });

  it("a validation failure clears the guard so the next Enter saves", async () => {
    createContact.mockResolvedValue({ id: "c1", firstName: "Brent", lastName: "Hendrickson" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Brent Hendrickson");
    // Empty name: fails validation before the repo is ever called.
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await screen.findByText("A contact needs a name.");
    expect(createContact).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: "Brent Hendrickson" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));
  });

  it("a repository error clears the guard and reports the error once", async () => {
    createContact
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "c1", firstName: "Brent", lastName: "Hendrickson" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Brent Hendrickson");
    fireEvent.change(nameInput, { target: { value: "Brent Hendrickson" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reportErrorMock).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(nameInput, { key: "Enter" });
    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(2));
  });
});

describe("QuickAddDialog: lands on the new record (F-LA-6a)", () => {
  it("saving a new contact lands on that contact's page", async () => {
    createContact.mockResolvedValue({ id: "c42", firstName: "Brent", lastName: "Hendrickson" });
    openQuickAdd("contact");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Brent Hendrickson");
    fireEvent.change(nameInput, { target: { value: "Brent Hendrickson" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/contacts/c42"));
    expect(offerUndoCreateMock).toHaveBeenCalledTimes(1);
  });

  it("saving a new company lands on that company's page", async () => {
    createCompany.mockResolvedValue({ id: "co9", name: "Sorensen Landscaping" });
    openQuickAdd("company");
    renderDialog();

    const nameInput = await screen.findByPlaceholderText("Sorensen Landscaping");
    fireEvent.change(nameInput, { target: { value: "Sorensen Landscaping" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/companies/co9"));
    expect(offerUndoCreateMock).toHaveBeenCalledTimes(1);
  });

  it("saving a task does not navigate, but still offers undo", async () => {
    createTask.mockResolvedValue({ id: "t1", title: "Call back" });
    openQuickAdd("task");
    renderDialog();

    const titleInput = await screen.findByPlaceholderText("Call back about the quote");
    fireEvent.change(titleInput, { target: { value: "Call back" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(offerUndoCreateMock).toHaveBeenCalledTimes(1);
  });
});
