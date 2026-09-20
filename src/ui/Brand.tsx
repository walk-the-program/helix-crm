import { cn } from "@/ui/cn";

/**
 * The Helix lockup: the mark and the word "Helix" beside it in the heading
 * face. Nothing else.
 *
 * ROUND 3: the sticker is gone. The lockup used to sit in a hard-edged square
 * with an offset outline behind it — the brand guide's signature. Walker saw
 * it in the running app and called it sloppy, and he was right about the small
 * size: at 26px in the sidebar a 1.5px ring offset 4px reads as a printing
 * misregistration, not as a sticker. It is retired product-wide
 * (`--shadow-sticker` is now `none`, see src/styles/tokens.css), so the mark
 * is drawn plain, with no square, no hairline and no outline. The brand's one
 * loud element is the flat primary block on the selected nav row.
 *
 * Two sizes and no more:
 *   sm  the sidebar header. A 26px mark and the word at --text-lg.
 *   lg  a boot screen. A 56px mark and the word at --text-heading.
 *
 * The word takes --color-heading — plain ink, never a tint.
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
  /** @deprecated Retired in round 3. Accepted and ignored. */
  sticker?: boolean;
  className?: string;
}) {
  const large = size === "lg";
  // `sticker` is accepted and ignored: the treatment is retired product-wide
  // and the prop stays only so no call site has to change on the same commit.
  void sticker;

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
          large ? "h-[56px] w-[56px]" : "h-[26px] w-[26px]",
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
