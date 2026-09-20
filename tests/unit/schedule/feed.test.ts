/**
 * The Schedule feed's mapping rules, one fixture per source, against fake
 * `ScheduleDeps` rather than a database - this file has no writes and no
 * table to stand up, only the shape of five reads and the union they land
 * in.
 */
import { describe, expect, it } from "vitest";
import { scheduleItems, type ScheduleDeps } from "@/features/schedule/lib/feed";
import type { ScheduleRange } from "@/features/schedule/lib/types";
import type { Task, TaskLink } from "@/db/repos/tasks";
import type { Deal } from "@/db/repos/deals";
import type { RecurringDue, RecurringRule } from "@/db/repos/recurring";
import type { Document } from "@/db/repos/documents";
import type { InvoiceSchedule } from "@/db/repos/invoiceSchedules";

const RANGE: ScheduleRange = { from: "2026-09-14", to: "2026-09-20" };

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Mow the lawn",
    dueOn: "2026-09-15",
    dueAt: null,
    doneAt: null,
    contactId: null,
    companyId: null,
    dealId: null,
    source: "user",
    place: null,
    durationMinutes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes: null,
    deletedAt: null,
    ...overrides,
  };
}

function taskLink(overrides: Partial<TaskLink> = {}): TaskLink {
  return {
    label: "Nella Okonkwo",
    href: "/contacts/c1",
    phone: "555-0100",
    email: "nella@example.com",
    contactId: "c1",
    companyId: null,
    dealId: null,
    ...overrides,
  };
}

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    title: "Fall cleanup",
    valueCents: 50000,
    currency: "USD",
    stageId: "stage-1",
    stageName: "New",
    stageIsWon: false,
    stageIsLost: false,
    stageEnteredAt: "2026-09-01T00:00:00.000Z",
    position: 0,
    contactId: "c2",
    contactFirstName: "Priya",
    contactLastName: "Shah",
    contactDeletedAt: null,
    companyId: null,
    companyName: null,
    companyDeletedAt: null,
    sourceId: null,
    externalId: null,
    expectedOn: "2026-09-16",
    closedAt: null,
    outcomeReason: null,
    oneTimeCents: 50000,
    recurringMonthlyCents: 0,
    recurringStartedOn: null,
    recurringEndedOn: null,
    suggestedTotalCents: 50000,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function recurringRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "rule-1",
    contactId: "c3",
    companyId: null,
    title: "Gutter clean",
    everyN: 1,
    unit: "year",
    nextDueOn: "2026-09-17",
    lastCompletedOn: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function recurringDue(overrides: Partial<RecurringDue> = {}): RecurringDue {
  return {
    rule: recurringRule(),
    label: "Mountain Shadows Assisted Living",
    href: "/companies/co1",
    phone: "555-0111",
    email: null,
    recordDeleted: false,
    daysUntil: 3,
    ...overrides,
  };
}

function invoice(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    kind: "invoice",
    number: "INV-2026-0001",
    dealId: "deal-1",
    dealTitle: "Fall cleanup",
    contactId: "c2",
    contactFirstName: "Priya",
    contactLastName: "Shah",
    companyId: null,
    companyName: null,
    status: "sent",
    issuedOn: "2026-09-01",
    dueOn: "2026-09-18",
    validUntil: null,
    subtotalCents: 50000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 50000,
    notes: null,
    paymentInstructions: null,
    convertedToId: null,
    sentAt: "2026-09-01T00:00:00.000Z",
    paidOn: null,
    paidMethod: null,
    paidNote: null,
    pdfPath: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function invoiceSchedule(overrides: Partial<InvoiceSchedule> = {}): InvoiceSchedule {
  return {
    id: "sched-1",
    dealId: "deal-2",
    dealTitle: "Monthly mowing",
    interval: "month",
    nextIssueOn: "2026-09-19",
    lastIssuedOn: null,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Deps with every source empty, so a test only has to override what it needs. */
function deps(overrides: Partial<ScheduleDeps> = {}): ScheduleDeps {
  return {
    listTasks: async () => [],
    taskLinks: async () => new Map(),
    listDeals: async () => [],
    listRules: async () => [],
    listInvoices: async () => [],
    listInvoiceSchedules: async () => [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* one fixture per source                                                    */
/* -------------------------------------------------------------------------- */

describe("scheduleItems: tasks", () => {
  it("maps an all-day task to kind 'task', linked to its contact", () => {
    return scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [task()],
        taskLinks: async () => new Map([["task-1", taskLink()]]),
      }),
    ).then((items) => {
      expect(items).toEqual([
        {
          id: "task:task-1",
          kind: "task",
          sourceId: "task-1",
          date: "2026-09-15",
          at: null,
          durationMinutes: null,
          title: "Mow the lawn",
          who: { label: "Nella Okonkwo", href: "/contacts/c1" },
          place: null,
          href: "/contacts/c1",
          contactId: "c1",
          companyId: null,
          dealId: null,
          phone: "555-0100",
          note: null,
        },
      ]);
    });
  });

  it("maps a timed task to kind 'visit', carrying place and duration", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [
          task({ dueAt: "2026-09-15T14:00:00.000Z", place: "123 Elm St", durationMinutes: 45 }),
        ],
        taskLinks: async () => new Map(),
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "visit:task-1",
      kind: "visit",
      at: "2026-09-15T14:00:00.000Z",
      place: "123 Elm St",
      durationMinutes: 45,
    });
  });

  it("skips a task with no dueOn", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listTasks: async () => [task({ dueOn: null })] }),
    );
    expect(items).toEqual([]);
  });

  it("gives who: null and href '/tasks' when the task's link is missing", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [task()],
        taskLinks: async () => new Map(),
      }),
    );
    expect(items[0].who).toBeNull();
    expect(items[0].href).toBe("/tasks");
  });
});

describe("scheduleItems: deals", () => {
  it("maps a deal's expected date to kind 'deal-expected', naming the live contact", async () => {
    const items = await scheduleItems(RANGE, deps({ listDeals: async () => [deal()] }));
    expect(items).toEqual([
      {
        id: "deal-expected:deal-1",
        kind: "deal-expected",
        sourceId: "deal-1",
        date: "2026-09-16",
        at: null,
        durationMinutes: null,
        title: "Fall cleanup",
        who: { label: "Priya Shah", href: "/contacts/c2" },
        place: null,
        href: "/deals/deal-1",
        contactId: "c2",
        companyId: null,
        dealId: "deal-1",
        phone: null,
        note: null,
      },
    ]);
  });

  it("falls back to the company when the contact is deleted", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listDeals: async () => [
          deal({
            contactDeletedAt: "2026-09-02T00:00:00.000Z",
            companyId: "co2",
            companyName: "Riverside HOA",
          }),
        ],
      }),
    );
    expect(items[0].who).toEqual({ label: "Riverside HOA", href: "/companies/co2" });
  });

  it("is who: null with no live contact and no company", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listDeals: async () => [deal({ contactId: null, contactDeletedAt: null })],
      }),
    );
    expect(items[0].who).toBeNull();
  });

  it("skips a deal with no expected date", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listDeals: async () => [deal({ expectedOn: null })] }),
    );
    expect(items).toEqual([]);
  });
});

describe("scheduleItems: recurring", () => {
  it("maps a due rule to kind 'recurring-due'", async () => {
    const items = await scheduleItems(RANGE, deps({ listRules: async () => [recurringDue()] }));
    expect(items).toEqual([
      {
        id: "recurring-due:rule-1",
        kind: "recurring-due",
        sourceId: "rule-1",
        date: "2026-09-17",
        at: null,
        durationMinutes: null,
        title: "Gutter clean",
        who: { label: "Mountain Shadows Assisted Living", href: "/companies/co1" },
        place: null,
        href: "/companies/co1",
        contactId: "c3",
        companyId: null,
        dealId: null,
        phone: "555-0111",
        note: null,
      },
    ]);
  });

  it("is who: null and href '/recurring' when the rule has no record attached", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listRules: async () => [
          recurringDue({
            label: null,
            href: null,
            rule: recurringRule({ contactId: null, companyId: null }),
          }),
        ],
      }),
    );
    expect(items[0].who).toBeNull();
    expect(items[0].href).toBe("/recurring");
  });

  it("excludes a rule whose next date is before the range", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listRules: async () => [
          recurringDue({ rule: recurringRule({ nextDueOn: "2026-09-01" }) }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });
});

describe("scheduleItems: invoices due", () => {
  it("maps a sent invoice's due date to kind 'invoice-due'", async () => {
    const items = await scheduleItems(RANGE, deps({ listInvoices: async () => [invoice()] }));
    expect(items).toEqual([
      {
        id: "invoice-due:doc-1",
        kind: "invoice-due",
        sourceId: "doc-1",
        date: "2026-09-18",
        at: null,
        durationMinutes: null,
        title: "Invoice INV-2026-0001",
        who: { label: "Priya Shah", href: "/contacts/c2" },
        place: null,
        href: "/invoices/doc-1",
        contactId: "c2",
        companyId: null,
        dealId: "deal-1",
        phone: null,
        note: null,
      },
    ]);
  });

  it("includes a partially paid invoice", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoices: async () => [invoice({ status: "partial" })] }),
    );
    expect(items).toHaveLength(1);
  });

  it.each(["draft", "paid", "void"])("excludes a %s invoice", async (status) => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoices: async () => [invoice({ status })] }),
    );
    expect(items).toEqual([]);
  });

  it("excludes an invoice whose due date is outside the range", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoices: async () => [invoice({ dueOn: "2026-10-01" })] }),
    );
    expect(items).toEqual([]);
  });

  it("skips an invoice with no due date", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoices: async () => [invoice({ dueOn: null })] }),
    );
    expect(items).toEqual([]);
  });
});

describe("scheduleItems: invoice schedules", () => {
  it("maps a schedule's next issue date to kind 'invoice-issue'", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoiceSchedules: async () => [invoiceSchedule()] }),
    );
    expect(items).toEqual([
      {
        id: "invoice-issue:sched-1",
        kind: "invoice-issue",
        sourceId: "sched-1",
        date: "2026-09-19",
        at: null,
        durationMinutes: null,
        title: "Monthly mowing",
        who: null,
        place: null,
        href: "/deals/deal-2",
        contactId: null,
        companyId: null,
        dealId: "deal-2",
        phone: null,
        note: null,
      },
    ]);
  });

  it("excludes a schedule whose next issue date is outside the range", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({ listInvoiceSchedules: async () => [invoiceSchedule({ nextIssueOn: "2026-10-01" })] }),
    );
    expect(items).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* the merged, sorted feed                                                   */
/* -------------------------------------------------------------------------- */

describe("scheduleItems: sort order", () => {
  it("puts timed items before all-day items on the same day", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [
          task({ id: "t-allday", dueOn: "2026-09-15", title: "All-day task" }),
          task({
            id: "t-timed",
            dueOn: "2026-09-15",
            dueAt: "2026-09-15T09:00:00.000Z",
            title: "Timed visit",
          }),
        ],
      }),
    );
    expect(items.map((i) => i.id)).toEqual(["visit:t-timed", "task:t-allday"]);
  });

  it("orders two timed items earliest first", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [
          task({ id: "t-late", dueOn: "2026-09-15", dueAt: "2026-09-15T15:00:00.000Z" }),
          task({ id: "t-early", dueOn: "2026-09-15", dueAt: "2026-09-15T08:00:00.000Z" }),
        ],
      }),
    );
    expect(items.map((i) => i.sourceId)).toEqual(["t-early", "t-late"]);
  });

  it("orders two all-day items on the same day by kind rank, not by source", async () => {
    // A recurring-due row and a task row on the same day: task (rank 1) sorts
    // before recurring-due (rank 3) regardless of read order.
    const items = await scheduleItems(
      { from: "2026-09-17", to: "2026-09-17" },
      deps({
        listTasks: async () => [
          task({ id: "t1", dueOn: "2026-09-17", title: "Zzz task" }),
        ],
        listRules: async () => [
          recurringDue({ rule: recurringRule({ nextDueOn: "2026-09-17", title: "Aaa reminder" }) }),
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["task", "recurring-due"]);
  });

  it("merges every source into one list sorted across days", async () => {
    const items = await scheduleItems(
      RANGE,
      deps({
        listTasks: async () => [task({ dueOn: "2026-09-20" })],
        listDeals: async () => [deal({ expectedOn: "2026-09-14" })],
        listInvoices: async () => [invoice({ dueOn: "2026-09-18" })],
      }),
    );
    expect(items.map((i) => i.date)).toEqual(["2026-09-14", "2026-09-18", "2026-09-20"]);
  });
});
