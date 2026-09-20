import { cn } from "@/ui/cn";

/**
 * The Helix lockup: the mark in a hard-edged square with the brand's offset
 * "sticker" shadow behind it, and the word "Helix" beside it in the heading
 * face.
 *
 * This is the one place --shadow-sticker is guaranteed to appear. The brand
 * guide calls it out by name — "hard edges with an offset sticker shadow" —
 * and it is the loudest thing the brand owns, so it stops being a signature
 * the moment a second element wears it. A screen may add it to at most one
 * hero element; nothing else.
 *
 * The shadow is an outline, not a slab: a thin ring offset down and right with
 * the surface showing through the gap. tokens.css explains how the two layered
 * box-shadows draw it, and --sticker-gap is why it has to be told what it is
 * standing on.
 *
 * Two sizes and no more:
 *   sm  the sidebar header. A 26px mark and the word at --text-lg.
 *   lg  a boot screen. A 56px mark and the word at --text-heading.
 *
 * The mark is a transparent PNG, so it needs a surface behind it for the
 * sticker shadow to read as an offset card rather than as a smear behind the
 * glyphs. That surface is --color-surface with a hairline, which is also what
 * the brand guide draws around it on its "Marks & Surfaces" page.
 */
export function Brand({
  size = "sm",
  wordmark = true,
  sticker = true,
  className,
}: {
  size?: "sm" | "lg";
  /** Draw the word "Helix" beside the mark. */
  wordmark?: boolean;
  /** The offset sticker outline. On by default; off where the lockup sits on a
   *  surface that already carries one. */
  sticker?: boolean;
  className?: string;
}) {
  const large = size === "lg";

  return (
    <span
      className={cn(
        "inline-flex items-center",
        large ? "gap-[var(--space-4)]" : "gap-[var(--space-3)]",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex flex-none items-center justify-center",
          "border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
          large ? "h-[56px] w-[56px] p-[var(--space-2)]" : "h-[26px] w-[26px] p-[3px]",
          sticker && "shadow-[var(--shadow-sticker)]",
        )}
      >
        <img
          src="/helix-logo.png"
          alt={wordmark ? "" : "Helix"}
          aria-hidden={wordmark || undefined}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </span>
      {wordmark ? (
        <span
          className={cn(
            "font-[family-name:var(--font-heading)] font-bold",
            "tracking-[var(--tracking-title)] text-[var(--color-heading)]",
            large
              ? "text-[length:var(--text-heading)] leading-[var(--leading-heading)]"
              : "text-[length:var(--text-lg)] leading-[var(--leading-tight)]",
          )}
        >
          Helix
        </span>
      ) : null}
    </span>
  );
}
