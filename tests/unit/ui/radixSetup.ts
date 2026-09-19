/**
 * Shared jsdom stubs needed for Radix UI primitives (Dialog, DropdownMenu) to
 * mount and interact correctly under jsdom, which implements none of
 * ResizeObserver, matchMedia, scrollIntoView, or the Pointer Capture API.
 *
 * Call installRadixStubs() at module scope (before any render()) in every
 * test file that renders a Radix-based component. It is idempotent, so it is
 * safe to import and call it from more than one test file.
 */
export function installRadixStubs(): void {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = NoopResizeObserver;
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  }

  if (typeof window.matchMedia !== "function") {
    window.matchMedia = function matchMedia(query: string): MediaQueryList {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    };
  }

  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
      return false;
    };
  }

  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  }

  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  }
}
