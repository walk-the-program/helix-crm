// @vitest-environment jsdom
/**
 * Empty states (phase-two design direction, rule 6): a title, one sentence,
 * one action — and two sizes, because the same component answers "this whole
 * screen is empty" and "this one section of six has nothing in it", and those
 * are not the same announcement.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyState } from "@/ui";

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("centres a title, one sentence and one action by default", () => {
    const { container } = render(
      <EmptyState
        title="No backups yet"
        description="Helix writes one every time you close the app."
        action={<button type="button">Back up now</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No backups yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain("text-center");
  });

  /**
   * The section-level form. A centred 17px heading repeated down a column of
   * six sections turns a quiet page into a page of announcements about
   * absence, so `quiet` is one muted sentence on the left and nothing else.
   */
  it("renders one muted, left-aligned sentence in the quiet variant", () => {
    const { container } = render(
      <EmptyState
        variant="quiet"
        title="No services yet"
        description="Add a service and its price shows up here."
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("text-center");
    expect(container.querySelector("h3")).toBeNull();
    const sentence = screen.getByText("Add a service and its price shows up here.");
    expect(sentence.className).toContain("text-[var(--color-text-muted)]");
    expect(sentence.className).toContain("text-[length:var(--text-sm)]");
  });

  /** So a caller can switch forms without rewriting its copy. */
  it("falls back to the title as the sentence when quiet has no description", () => {
    render(<EmptyState variant="quiet" title="Nothing due this week." />);
    expect(screen.getByText("Nothing due this week.")).toBeTruthy();
  });

  it("still allows exactly one action in the quiet variant", () => {
    render(
      <EmptyState
        variant="quiet"
        title="No tags yet."
        action={<button type="button">Add a tag</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Add a tag" })).toBeTruthy();
  });

  /** Density is a token: neither form hard-codes a height. */
  it("sizes the quiet row from --row-h", () => {
    const { container } = render(<EmptyState variant="quiet" title="Nothing here." />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-h-[var(--row-h)]");
    expect(root.className).not.toMatch(/h-\[\d+px\]/);
  });
});
