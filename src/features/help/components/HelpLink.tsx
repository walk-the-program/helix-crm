/**
 * A small, honest link from wherever an owner is actually stuck - an empty
 * state, a failed connection, a Diagnostics row - straight to the Help
 * section that answers it, instead of only being reachable from the Help
 * screen itself (LR-CS-W3, contextual help reachability).
 *
 * Deliberately not a tour, a wizard or a coach-mark: it is one inline link,
 * styled the way DESIGN.md section 12 asks every link to be - ink, with an
 * underline, no tinted colour - and it always lands on a real
 * `HelpSection.id` from `src/features/help/lib/content.ts`, never a made-up
 * anchor. `HelpScreen.tsx` scrolls to the matching section on mount.
 *
 * Exported from the feature's own barrel (`src/features/help/index.tsx`) so
 * another feature imports it the same way `src/features/leads` already
 * shares `ReportsFrame` - a public seam, not a reach into this feature's
 * internals.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";

export function HelpLink(props: { to: string; children: ReactNode; className?: string }) {
  const { to, children, className } = props;
  return (
    <Link
      href={`/help#${to}`}
      className={
        className ??
        "text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
      }
    >
      {children}
    </Link>
  );
}
