// @vitest-environment jsdom
/**
 * F-LB-D23 (phase two, design): the TAX column on a locked document. A
 * column of identical "Yes" - or a checkbox column nobody can touch any
 * more - is noise on a rule-1 table (docs/DESIGN.md's owner-facing scan
 * order) and it was the reason a real service name truncated at 1024px.
 * `renderDocument.ts`'s PDF already shows a line's taxability only when the
 * document mixes taxable and non-taxable lines; this is that same rule
 * applied to the read-only screen table. The editable table keeps the
 * column and the checkbox in every case, because the owner needs it to set
 * taxability before a rate exists at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DocumentLines, type DraftLine } from "@/features/invoices/components/DocumentLines";

afterEach(() => {
  cleanup();
});

// DocumentLines always mounts `ServicesPicker` (behind "Add a line"), which
// reads `useQueryClient()` even while its own dialog is closed, so every
// render needs a provider - the same shape the catalog and records dialog
// tests already use.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function line(overrides: Partial<DraftLine>): DraftLine {
  return {
    key: overrides.key ?? Math.random().toString(36),
    name: "Spring cleanup",
    description: "",
    qty: "1",
    unit: "100.00",
    taxable: false,
    kind: "one_time",
    interval: null,
    ...overrides,
  };
}

describe("DocumentLines: the TAX column on a locked document", () => {
  it("hides the Tax column when every line agrees, even under a real tax rate", () => {
    render(
      <DocumentLines
        lines={[line({ key: "a", taxable: true }), line({ key: "b", taxable: true })]}
        editable={false}
        taxRateBp={825}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Tax" })).toBeNull();
    expect(screen.queryByText("Yes")).toBeNull();
  });

  it("hides the Tax column when the rate is zero and no line is taxable", () => {
    render(
      <DocumentLines
        lines={[line({ key: "a", taxable: false }), line({ key: "b", taxable: false })]}
        editable={false}
        taxRateBp={0}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Tax" })).toBeNull();
  });

  it("keeps the Tax column when the document actually mixes taxable and not", () => {
    render(
      <DocumentLines
        lines={[line({ key: "a", taxable: true }), line({ key: "b", taxable: false })]}
        editable={false}
        taxRateBp={825}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Tax" })).not.toBeNull();
  });

  it("keeps the Tax column and its checkbox in the editable table regardless of mix", () => {
    render(
      <DocumentLines
        lines={[line({ key: "a", taxable: false }), line({ key: "b", taxable: false })]}
        editable
        onChange={() => {}}
        taxRateBp={0}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Tax" })).not.toBeNull();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("gives Description the freed width once the Tax column is gone", () => {
    const { container } = render(
      <DocumentLines
        lines={[line({ key: "a", taxable: false }), line({ key: "b", taxable: false })]}
        editable={false}
        taxRateBp={0}
      />,
    );
    const header = screen.getByRole("columnheader", { name: "Description" });
    expect(header.className).toContain("w-[52%]");
    void container;
  });
});
