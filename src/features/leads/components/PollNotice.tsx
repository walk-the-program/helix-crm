/**
 * The one line on Today that says lead collection has stopped.
 *
 * `PollBanner` is the full explanation and it lives on Settings > Website,
 * which is the only place it is rendered. That is where the fix is, so that is
 * the right home for it - but it means an owner who does not routinely open
 * Settings has no way to learn that leads stopped arriving except by noticing
 * an absence, and an absence of leads looks exactly like a quiet week (CPO
 * audit, F-LB-18). Two jobs, says docs/PLAN.md, and the first one is "do not
 * lose a lead".
 *
 * So this is the quiet half: one sentence, on the screen he opens every
 * morning, linking to the screen that can fix it. It renders nothing at all
 * when the poll is healthy, when no site is connected, and while the poller is
 * still inside its silent first two retries - the banner's own rule, which
 * this reads rather than re-implements (`status.bannerVisible`). A laptop that
 * drove through a canyon must not put anything on Today.
 *
 * It is text and a link, not a card, not a colour and not an icon: Today's
 * sections are the owner's work, and this is a footnote about the plumbing.
 */
import { Link } from "wouter";
import { usePollStatus } from "@/features/leads/hooks";

export function PollNotice() {
  const status = usePollStatus();
  if (!status.bannerVisible || !status.lastError) return null;

  const isAuth = status.lastError.kind === "auth";
  return (
    <p
      data-testid="poll-notice"
      className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
    >
      {isAuth
        ? "New leads are not coming in: your website turned the connection down."
        : "New leads are not coming in: Helix cannot reach your website."}{" "}
      <Link
        href="/settings/site"
        className="text-[var(--color-text)] underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
      >
        Check the website connection
      </Link>
    </p>
  );
}
