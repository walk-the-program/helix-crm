import type { ReactNode } from "react";
import { headingFont } from "@/ui/styles";

/**
 * The page title, set at the brand guide's Heading step: 32/1.1 in Zilla Slab
 * bold, tracked -0.01em, in the near-black. It is the largest type on any
 * screen and the only thing on the screen allowed to be that large.
 *
 * It truncates with a title attribute rather than wrapping — a 47-character
 * company name is the normal case, not the exception — and the breadcrumb and
 * subtitle stay in Poppins, so the slab is doing one job in one place.
 *
 * No bottom hairline. The toolbar above it already draws one, and a second
 * rule 24px below the first is the kind of detail that makes a window look
 * assembled rather than designed. Air separates the header from the content.
 */
export function PageHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  const { title, subtitle, actions, breadcrumb } = props;

  return (
    <div
      className={[
        "flex w-full flex-wrap items-end justify-between",
        "gap-[var(--space-3)] pb-[var(--space-5)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-[var(--space-1)] min-w-0">
        {breadcrumb ? (
          <div className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
            {breadcrumb}
          </div>
        ) : null}
        <h1
          className={[
            "truncate",
            headingFont,
            "text-[length:var(--text-heading)] font-bold",
            "leading-[var(--leading-heading)]",
          ].join(" ")}
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-none items-center gap-[var(--space-2)]">{actions}</div>
      ) : null}
    </div>
  );
}
