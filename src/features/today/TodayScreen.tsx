/**
 * Today: the first screen after boot and the answer to the two-sentence test
 * in docs/PLAN.md — the owner does not want a CRM, he wants to not lose a lead
 * and to remember what he promised.
 *
 * The order is fixed by DESIGN.md section 3 and is not a preference: Due now,
 * New leads, Gone quiet, Recent activity, then the one card that asks for
 * something. Each section renders its own designed empty state, so a workspace
 * with three contacts in it still looks finished.
 *
 * A brand-new workspace gets a different screen entirely — four empty panels
 * stacked up is not a first impression, it is a failure. That screen shows the
 * three things that fill Today, and nothing else.
 */

import { Link } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { FileSpreadsheet, Globe, Search, UserPlus } from "lucide-react";
import { Button, Kbd, PageHeader } from "@/ui";
import { allCommands } from "@/app/registry";
import { DueNowSection } from "@/features/today/sections/DueNow";
import { NewLeadsSection } from "@/features/today/sections/NewLeads";
import { GoneQuietSection } from "@/features/today/sections/GoneQuiet";
import { RecentActivitySection } from "@/features/today/sections/RecentActivity";
import { ConnectSiteCard } from "@/features/today/sections/ConnectSite";
import { openSearch, SEARCH_SHORTCUT } from "@/features/today/search/overlay";
import { useWorkspaceIsEmpty } from "@/features/today/lib/useToday";

/**
 * Quick add belongs to the records agent and is registered as a palette
 * command, so Today runs *that* rather than growing a second copy of the form.
 * Until records ships it, the button takes him to Contacts, which is where he
 * would go next anyway.
 */
export function runQuickAdd(): void {
  const command = allCommands().find((c) => c.id === "quick-add");
  if (command) {
    void command.run();
    return;
  }
  navigate("/contacts");
}

function todayLabel(): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  } catch {
    return "";
  }
}

/** The four-panel screen, for a workspace with anything at all in it. */
function TodayPanels() {
  return (
    <div className="flex flex-col gap-[var(--space-7)]">
      <DueNowSection />
      <NewLeadsSection />
      <GoneQuietSection />
      <RecentActivitySection />
      <ConnectSiteCard />
    </div>
  );
}

/** The first-run screen: the three actions that put something on Today. */
function FirstRun() {
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="max-w-[var(--content-max)]">
        <h2 className="text-[length:var(--text-xl)] font-semibold text-[var(--color-text)]">
          Nothing here yet, and that is the right place to start
        </h2>
        <p className="mt-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Today shows what is due, which leads nobody has called, and which
          deals have gone quiet. Do one of these three things and it fills up on
          its own.
        </p>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-[var(--space-4)] p-0 lg:grid-cols-3">
        <li className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)] shadow-[var(--shadow-sm)]">
          <FileSpreadsheet
            size={24}
            className="text-[var(--color-text-faint)]"
            aria-hidden
          />
          <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
            Import a spreadsheet
          </h3>
          <p className="flex-1 text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            A CSV from your old CRM, your accountant, or a sheet you keep
            yourself. Five minutes, and you keep every column you care about.
          </p>
          <Link
            href="/import"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            Import a CSV
          </Link>
        </li>

        <li className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)] shadow-[var(--shadow-sm)]">
          <UserPlus size={24} className="text-[var(--color-text-faint)]" aria-hidden />
          <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
            Add one contact
          </h3>
          <p className="flex-1 text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            The customer you spoke to this morning. A name is enough; everything
            else can wait until you need it.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="min-h-[44px]"
            onClick={runQuickAdd}
          >
            Add a contact
          </Button>
        </li>

        <li className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)] shadow-[var(--shadow-sm)]">
          <Globe size={24} className="text-[var(--color-text-faint)]" aria-hidden />
          <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
            Connect your website
          </h3>
          <p className="flex-1 text-[length:var(--text-base)] text-[var(--color-text-muted)]">
            Quote requests from your site land here by themselves, with the
            message the customer typed.
          </p>
          <Link
            href="/settings/site"
            className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            Connect website
          </Link>
        </li>
      </ul>
    </div>
  );
}

export function TodayScreen() {
  const { data: isEmpty, isLoading } = useWorkspaceIsEmpty();

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Today"
        subtitle={todayLabel()}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="min-h-[44px]"
            iconLeft={<Search size={16} aria-hidden />}
            onClick={openSearch}
          >
            Search records <Kbd keys={SEARCH_SHORTCUT} />
          </Button>
        }
      />

      <div className="max-w-[1100px]">
        {isLoading ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : isEmpty ? (
          <FirstRun />
        ) : (
          <TodayPanels />
        )}
      </div>
    </div>
  );
}
