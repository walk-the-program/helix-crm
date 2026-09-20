// @vitest-environment jsdom
/**
 * The sortable column header shared by `TH` (the pipeline's table list view)
 * and `ColumnHeaderCell` (the flex column strip above Contacts' and
 * Companies' virtualised lists) - apple-hig-review.md finding 6 / top-ten
 * item 9: "reuse the existing sortable TH... bind the sort Select to the
 * same state so both stay in sync".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ariaSortValue } from "@/ui";
import { installRadixStubs } from "./radixSetup";
import { renderColumnHeaderSortFixture, renderTableSortFixture } from "./fixtures";

installRadixStubs();

afterEach(() => {
  cleanup();
});

describe("TH (table sortable header)", () => {
  it("aria-sort is none when the column is sortable but not the active sort", () => {
    renderTableSortFixture({ initialSort: "newest" });
    expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("none");
  });

  it("flips ascending -> descending -> ascending on repeated clicks", async () => {
    const user = userEvent.setup();
    renderTableSortFixture({ initialSort: "name-asc" });
    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header.getAttribute("aria-sort")).toBe("ascending");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(header.getAttribute("aria-sort")).toBe("descending");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });
});

describe("ariaSortValue", () => {
  it("is undefined for a non-sortable column - no aria-sort attribute at all, not 'none'", () => {
    // A non-sortable cell ("Tags", "Phone") never claims a direction; TH and
    // ColumnHeaderCell both feed this straight into their `aria-sort` prop, so
    // undefined here is what keeps the attribute off the rendered element.
    expect(ariaSortValue(false, "asc")).toBeUndefined();
    expect(ariaSortValue(undefined, null)).toBeUndefined();
  });

  it("maps asc/desc/null to the three real aria-sort values when sortable", () => {
    expect(ariaSortValue(true, "asc")).toBe("ascending");
    expect(ariaSortValue(true, "desc")).toBe("descending");
    expect(ariaSortValue(true, null)).toBe("none");
  });
});

describe("ColumnHeaderCell (Contacts/Companies column strip)", () => {
  it("clicking the header changes the exact same state the Select shows", async () => {
    const user = userEvent.setup();
    renderColumnHeaderSortFixture({ initialSort: "name-asc" });

    const header = screen.getByRole("columnheader", { name: "Name" });
    const select = screen.getByRole("combobox", { name: "Sort" });

    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(select.textContent).toContain("Name A to Z");

    await user.click(screen.getByRole("button", { name: "Name" }));

    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(select.textContent).toContain("Name Z to A");

    await user.click(screen.getByRole("button", { name: "Name" }));

    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(select.textContent).toContain("Name A to Z");
  });

  it("reads aria-sort=none before either the header or the Select has been touched", () => {
    renderColumnHeaderSortFixture({ initialSort: "newest" });
    expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("none");
    // "newest" is not one of the header's two orders, and the Select shows it
    // as neither "Name A to Z" nor "Name Z to A" - the two stay consistent by
    // both being unable to describe it.
    const select = screen.getByRole("combobox", { name: "Sort" });
    expect(select.textContent).not.toContain("Name A to Z");
    expect(select.textContent).not.toContain("Name Z to A");
  });
});
