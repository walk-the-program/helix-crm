/**
 * "Connect your website" — the one card Today is allowed to ask for something.
 *
 * It appears until either `settings.site_origin` is set or the owner dismisses
 * it, and the dismissal is stored (`settings.connect_card_dismissed`) so it
 * never comes back on its own. That is the whole trust contract: one ask, a
 * real "no", and no second chances taken. PLAN.md's "no upgrade prompts
 * anywhere" applies here more than anywhere else on the screen.
 *
 * The settings screen itself belongs to the leads agent, at /settings/site.
 */

import { Globe, X } from "lucide-react";
import { Link } from "wouter";
import { Button, toast } from "@/ui";
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
      className="relative flex items-start gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)] shadow-[var(--shadow-sm)]"
    >
      <Globe
        size={24}
        className="mt-[2px] shrink-0 text-[var(--color-text-faint)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1 pr-[var(--space-8)]">
        <h2
          id="today-connect-heading"
          className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]"
        >
          Send quote-form leads straight here
        </h2>
        <p className="mt-[var(--space-2)] max-w-[var(--content-max)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Paste your site address and the token from your website settings.
          Helix checks for new quote requests when it opens and every five
          minutes while it is running.
        </p>
        <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
          <Link
            href="/settings/site"
            className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            Connect website
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-[44px]"
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

      <button
        type="button"
        aria-label="Dismiss the website card"
        onClick={() => dismiss.mutate()}
        className="absolute right-[var(--space-3)] top-[var(--space-3)] inline-flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <X size={16} aria-hidden />
      </button>
    </section>
  );
}
