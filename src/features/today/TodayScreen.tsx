/**
 * Today: the first screen after boot and the answer to the two-sentence test
 * in docs/PLAN.md — the owner does not want a CRM, he wants to not lose a lead
 * and to remember what he promised.
 *
 * The order is fixed by DESIGN.md §3 and is not a preference: Due now, New
 * leads, Gone quiet, Recent activity, then the one card that asks for
 * something. Due now is first because it is what needs him, and that position
 * plus full-strength ink is the whole of the emphasis — there is no attention
 * colour on this screen (§5).
 *
 * A brand-new workspace gets a different screen entirely. Four empty panels
 * stacked up is not a first impression, it is a failure. That screen shows the
 * three things that fill Today and nothing else, with one primary block on it.
 */

import type { ReactNode } from "react";
import { Link } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { MagnifyingGlass } from "@/ui/icons";
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

/**
 * The four-panel screen. `--space-8` between sections rather than a tighter
 * gap: air is what separates a native pane from a web page, and a section
 * heading needs room above it to read as a heading.
 */
function TodayPanels() {
  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <DueNowSection />
      <NewLeadsSection />
      <GoneQuietSection />
      <RecentActivitySection />
      <ConnectSiteCard />
    </div>
  );
}

/**
 * One of the three first-run panels. A grouped inset list with a title, a
 * sentence and its own control — no spot glyph, because a decorative icon in
 * the middle of an empty pane is the thing that makes a desktop app look like
 * a marketing page (DESIGN.md §11).
 */
function StarterCard(props: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-[var(--space-2)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]">
      <h3>
        {props.title}
      </h3>
      <p className="flex-1 text-[length:var(--text-base)] text-[var(--color-text-muted)]">
        {props.description}
      </p>
      <div className="mt-[var(--space-2)] flex">{props.action}</div>
    </li>
  );
}

/** A link drawn as the one black button on the screen. */
const primaryLinkClasses = [
  "inline-flex h-[var(--control-h)] flex-none items-center justify-center",
  "bg-[var(--color-accent)] px-[var(--space-4)] no-underline shadow-[var(--shadow-sticker)]",
  "text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-accent-text)]",
  "hover:bg-[var(--color-accent-hover)] hover:no-underline",
  "active:scale-[var(--press-scale)] motion-reduce:active:scale-100",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
].join(" ");

/** A link drawn as a macOS push button: white fill, one hairline, full ink. */
const secondaryLinkClasses = [
  "inline-flex h-[var(--control-h)] flex-none items-center justify-center",
  "border border-[var(--color-border-strong)]",
  "bg-[var(--color-surface)] px-[var(--space-4)] no-underline",
  "text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)]",
  "hover:bg-[var(--color-hover)] hover:no-underline",
  "active:scale-[var(--press-scale)] motion-reduce:active:scale-100",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
].join(" ");

/** The first-run screen: the three actions that put something on Today. */
function FirstRun() {
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="max-w-[var(--content-max)]">
        <h2>
          Nothing here yet, and that is the right place to start
        </h2>
        <p className="mt-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Today shows what is due, which leads nobody has called, and which
          deals have gone quiet. Do one of these three things and it fills up on
          its own.
        </p>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-[var(--space-4)] p-0 lg:grid-cols-3">
        <StarterCard
          title="Import a spreadsheet"
          description="A CSV from your old CRM, your accountant, or a sheet you keep yourself. Five minutes, and you keep every column you care about."
          action={
            <Link href="/import" className={primaryLinkClasses}>
              Import a CSV
            </Link>
          }
        />
        <StarterCard
          title="Add one contact"
          description="The customer you spoke to this morning. A name is enough; everything else can wait until you need it."
          action={
            <Button type="button" variant="secondary" onClick={runQuickAdd}>
              Add a contact
            </Button>
          }
        />
        <StarterCard
          title="Connect your website"
          description="Quote requests from your site land here by themselves, with the message the customer typed."
          action={
            <Link href="/settings/site" className={secondaryLinkClasses}>
              Connect website
            </Link>
          }
        />
      </ul>
    </div>
  );
}

export function TodayScreen() {
  const { data: isEmpty, isLoading } = useWorkspaceIsEmpty();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Today"
        subtitle={todayLabel()}
        actions={
          <Button
            type="button"
            variant="secondary"
            iconLeft={
              <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
            }
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
