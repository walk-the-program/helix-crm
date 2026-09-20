/**
 * `composeVisit` is the pure half of "schedule a visit" and is tested here
 * with no database at all; `saveVisit` and `defaultPlaceFor` are the impure
 * half, exercised against mocked repositories so the undo path and the
 * address fallback are checked without a real write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tasksCreate = vi.fn();
const tasksUpdate = vi.fn();
vi.mock("@/db/repos/tasks", () => ({
  create: (...args: unknown[]) => tasksCreate(...args),
  update: (...args: unknown[]) => tasksUpdate(...args),
}));

const contactsGet = vi.fn();
vi.mock("@/db/repos/contacts", () => ({
  get: (...args: unknown[]) => contactsGet(...args),
}));

const companiesGet = vi.fn();
vi.mock("@/db/repos/companies", () => ({
  get: (...args: unknown[]) => companiesGet(...args),
}));

const invalidateRecords = vi.fn().mockResolvedValue(undefined);
const offerUndoCreate = vi.fn();
const newBatchId = vi.fn(() => "batch-1");
vi.mock("@/features/records/lib/mutations", () => ({
  invalidateRecords: (...args: unknown[]) => invalidateRecords(...args),
  offerUndoCreate: (...args: unknown[]) => offerUndoCreate(...args),
  newBatchId: () => newBatchId(),
}));

import {
  composeVisit,
  defaultPlaceFor,
  saveVisit,
  taskEndAt,
  VISIT_DURATIONS,
  VISIT_TITLES,
  type VisitForm,
} from "@/features/schedule/lib/visit";

function baseForm(overrides: Partial<VisitForm> = {}): VisitForm {
  return {
    title: "Visit",
    date: "2026-09-23",
    time: "09:00",
    durationMinutes: 60,
    place: null,
    note: "",
    contactId: null,
    companyId: null,
    dealId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  newBatchId.mockReturnValue("batch-1");
});

describe("constants", () => {
  it("offers the three title chips", () => {
    expect(VISIT_TITLES).toEqual(["Visit", "Estimate", "Site visit"]);
  });

  it("offers the four duration chips", () => {
    expect(VISIT_DURATIONS).toEqual([30, 60, 90, 120]);
  });
});

describe("composeVisit", () => {
  it("combines the date and time into dueOn/dueAt", () => {
    const write = composeVisit(baseForm({ date: "2026-09-23", time: "09:30" }));
    expect(write.dueOn).toBe("2026-09-23");
    expect(write.dueAt).not.toBeNull();
    const start = new Date(write.dueAt as string);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(30);
  });

  it("clears dueOn and dueAt when the date is empty", () => {
    const write = composeVisit(baseForm({ date: "", time: "09:00" }));
    expect(write.dueOn).toBeNull();
    expect(write.dueAt).toBeNull();
  });

  it("drops the duration when there is no usable time - a visit's length means nothing without a start", () => {
    const write = composeVisit(baseForm({ time: "", durationMinutes: 90 }));
    expect(write.dueAt).toBeNull();
    expect(write.durationMinutes).toBeNull();
  });

  it("keeps the duration when a time is present", () => {
    const write = composeVisit(baseForm({ durationMinutes: 90 }));
    expect(write.durationMinutes).toBe(90);
  });

  it("keeps the note out of the title: they are two fields, not one", () => {
    const write = composeVisit(baseForm({ title: "Estimate", note: "Bring the long ladder" }));
    expect(write.title).toBe("Estimate");
    expect(write.notes).toBe("Bring the long ladder");
  });

  it("trims the title and turns a blank note into null", () => {
    const write = composeVisit(baseForm({ title: "  Visit  ", note: "  " }));
    expect(write.title).toBe("Visit");
    expect(write.notes).toBeNull();
  });

  it("trims a place and turns a blank one into null", () => {
    expect(composeVisit(baseForm({ place: "  12 Main St  " })).place).toBe("12 Main St");
    expect(composeVisit(baseForm({ place: "   " })).place).toBeNull();
    expect(composeVisit(baseForm({ place: null })).place).toBeNull();
  });

  it("passes contact, company and job ids through unchanged", () => {
    const write = composeVisit(
      baseForm({ contactId: "c1", companyId: "co1", dealId: "d1" }),
    );
    expect(write.contactId).toBe("c1");
    expect(write.companyId).toBe("co1");
    expect(write.dealId).toBe("d1");
  });
});

describe("defaultPlaceFor", () => {
  it("prefers the contact's address and never reads the company when it has one", async () => {
    contactsGet.mockResolvedValue({ addressJson: JSON.stringify({ line1: "12 Main St", city: "Springfield" }) });
    const place = await defaultPlaceFor({ contactId: "c1", companyId: "co1" });
    expect(place).toBe("12 Main St, Springfield");
    expect(companiesGet).not.toHaveBeenCalled();
  });

  it("falls back to the company's address when the contact has none", async () => {
    contactsGet.mockResolvedValue({ addressJson: null });
    companiesGet.mockResolvedValue({ addressJson: JSON.stringify({ line1: "1 Industrial Way" }) });
    const place = await defaultPlaceFor({ contactId: "c1", companyId: "co1" });
    expect(place).toBe("1 Industrial Way");
  });

  it("returns null when neither has an address", async () => {
    contactsGet.mockResolvedValue({ addressJson: null });
    companiesGet.mockResolvedValue({ addressJson: null });
    expect(await defaultPlaceFor({ contactId: "c1", companyId: "co1" })).toBeNull();
  });

  it("returns null when there is nothing to look up", async () => {
    expect(await defaultPlaceFor({})).toBeNull();
    expect(contactsGet).not.toHaveBeenCalled();
    expect(companiesGet).not.toHaveBeenCalled();
  });

  it("never throws when the read fails - an address is a nicety", async () => {
    contactsGet.mockRejectedValue(new Error("database is locked"));
    await expect(defaultPlaceFor({ contactId: "c1" })).resolves.toBeNull();
  });
});

describe("saveVisit", () => {
  it("creates a new task with source \"user\" and offers the same undo any other create gets", async () => {
    tasksCreate.mockResolvedValue({ id: "t1", title: "Visit", dueOn: "2026-09-23", dueAt: "2026-09-23T13:00:00.000Z", doneAt: null });

    const saved = await saveVisit(baseForm());

    expect(saved.id).toBe("t1");
    expect(tasksCreate).toHaveBeenCalledTimes(1);
    const [input, options] = tasksCreate.mock.calls[0] as [Record<string, unknown>, { batchId: string }];
    expect(input.source).toBe("user");
    expect(options.batchId).toBe("batch-1");
    expect(invalidateRecords).toHaveBeenCalledTimes(1);
    expect(offerUndoCreate).toHaveBeenCalledTimes(1);
    expect(offerUndoCreate).toHaveBeenCalledWith("batch-1", expect.stringContaining('"Visit"'));
    expect(tasksUpdate).not.toHaveBeenCalled();
  });

  it("updates the task named by taskId instead of creating one, with no undo offered", async () => {
    tasksUpdate.mockResolvedValue({ id: "t1", title: "Visit", dueOn: "2026-09-23", dueAt: "2026-09-23T13:00:00.000Z", doneAt: null });

    const saved = await saveVisit(baseForm({ taskId: "t1" }));

    expect(saved.id).toBe("t1");
    expect(tasksUpdate).toHaveBeenCalledTimes(1);
    expect(tasksUpdate.mock.calls[0][0]).toBe("t1");
    expect(tasksCreate).not.toHaveBeenCalled();
    expect(offerUndoCreate).not.toHaveBeenCalled();
    expect(invalidateRecords).toHaveBeenCalledTimes(1);
  });
});

describe("taskEndAt", () => {
  it("adds the duration in minutes to the start", () => {
    const end = taskEndAt({ dueAt: "2026-09-23T13:00:00.000Z", durationMinutes: 90 });
    expect(end).toBe("2026-09-23T14:30:00.000Z");
  });

  it("is null with no start", () => {
    expect(taskEndAt({ dueAt: null, durationMinutes: 60 })).toBeNull();
  });

  it("is null with no duration", () => {
    expect(taskEndAt({ dueAt: "2026-09-23T13:00:00.000Z", durationMinutes: null })).toBeNull();
  });

  it("crosses a day boundary correctly", () => {
    const end = taskEndAt({ dueAt: "2026-09-23T23:30:00.000Z", durationMinutes: 60 });
    expect(end).toBe("2026-09-24T00:30:00.000Z");
  });
});
