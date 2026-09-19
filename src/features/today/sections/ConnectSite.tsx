/**
 * "Connect your website" — the one card Today is allowed to ask for something.
 *
 * It appears until either `settings.site_origin` is set or the owner dismisses
 * it, and the dismissal is stored (`settings.connect_card_dismissed`) so it
 * never comes back on its own. That is the whole trust contract: one ask, a
 * real "no", and no second chances taken. PLAN.md's "no upgrade prompts
 * anywhere" applies here more than anywhere else on the screen.
 *
 * It is drawn as the quietest thing on Today, which is the point: a grouped
 * inset panel with no shadow, no spot glyph, and no primary fill — the primary
 * button on this screen belongs to what the owner came here to do, not to an
 * ask (DESIGN.md §5, §11).
 *
 * The settings screen itself belongs to the leads agent, at /settings/site.
 */

import { X } from "@/ui/icons";
import { Link } from "wouter";
import { Button, IconButton, toast } from "@/ui";
import {
  useConnectCard,
  useDismissConnectCard,
} from "@/features/today/lib/useToday";

export function ConnectSiteCard() {
  const { data } = useConnectCard();
  const dismiss = useDismissConnectCard();

  if (!data?.show) return null;

  return (
    <section
      aria-labelledby="today-connect-heading"
      data-today-section="connect-site"
      className="relative border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
    >
      <div className="min-w-0 pr-[var(--space-8)]">
        <h2 id="today-connect-heading">
          Send quote-form leads straight here
        </h2>
        <p className="mt-[var(--space-2)] max-w-[var(--content-max)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Paste your site address and the token from your website settings.
          Helix checks for new quote requests when it opens and every five
          minutes while it is running.
        </p>
        <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
          <Link
            href="/settings/site"
            className="inline-flex h-[var(--control-h)] flex-none items-center justify-center border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-[var(--space-4)] text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)] no-underline hover:bg-[var(--color-hover)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            Connect website
          </Link>
          <Button
            type="button"
            variant="ghost"
            loading={dismiss.isPending}
            onClick={() =>
              dismiss.mutate(undefined, {
                onSuccess: () =>
                  toast.success(
                    "Hidden. Connect a website any time from Settings.",
                  ),
              })
            }
          >
            Not now
          </Button>
        </div>
      </div>

      <IconButton
        label="Dismiss the website card"
        className="absolute right-[var(--space-3)] top-[var(--space-3)]"
        icon={<X size={16} weight="bold" aria-hidden="true" />}
        onClick={() => dismiss.mutate()}
      />
    </section>
  );
}
