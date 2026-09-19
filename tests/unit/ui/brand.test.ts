// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Brand } from "@/ui";
import type { ComponentProps } from "react";

afterEach(() => {
  cleanup();
});

function renderBrand(props: ComponentProps<typeof Brand> = {}) {
  return render(React.createElement(Brand, props));
}

/** The square the mark sits in — the element that wears the sticker shadow.
 *  Found through the image rather than by span index, so a wrapper added
 *  later does not silently point these assertions at the wrong element. */
function markBox(container: HTMLElement): HTMLElement {
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  return img!.parentElement as HTMLElement;
}

describe("Brand", () => {
  it("renders the mark as a root-relative path, never an absolute URL, because the app is offline", () => {
    const { container } = renderBrand();

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/helix-logo.png");
  });

  it("carries the sticker shadow by default, and drops it when sticker={false}", () => {
    // This is the brand guide's signature ("hard edges with an offset sticker
    // shadow in the accent color") and must be on unless a caller opts out.
    const { container: withSticker } = renderBrand();
    expect(markBox(withSticker).className).toContain("shadow-[var(--shadow-sticker)]");
    cleanup();

    const { container: withoutSticker } = renderBrand({ sticker: false });
    expect(markBox(withoutSticker).className).not.toContain("shadow-[var(--shadow-sticker)]");
  });

  it("renders the wordmark by default in the heading face", () => {
    const { getByText } = renderBrand();

    const word = getByText("Helix");
    expect(word.className).toContain("font-[family-name:var(--font-heading)]");
  });

  it("wordmark={false} drops the word and gives the mark a real alt, so it is not left unlabelled", () => {
    const { container, queryByText } = renderBrand({ wordmark: false });

    expect(queryByText("Helix")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Helix");
    expect(img?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("with the wordmark present, the mark is decorative: empty alt and aria-hidden, so a screen reader does not read Helix twice", () => {
    const { container } = renderBrand({ wordmark: true });

    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("size lg and sm produce different mark box sizes", () => {
    const { container: lg } = renderBrand({ size: "lg" });
    expect(markBox(lg).className).toContain("h-[56px]");
    cleanup();

    const { container: sm } = renderBrand({ size: "sm" });
    expect(markBox(sm).className).toContain("h-[26px]");
  });
});
