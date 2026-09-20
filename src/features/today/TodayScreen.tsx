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
 * A workspace that has not started yet gets a different screen entirely. Four
 * empty panels stacked up is not a first impression, it is a failure. That
 * screen shows the three things that fill Today and nothing else, with one
 * primary block on it.
 *
 * "Has not started" is deliberately not "has no rows": saving one contact used
 * to flip this screen to the empty panels, so the owner did what the card asked
 * and got a blanker screen than before (CPO audit, F-LA-6). The starter cards
 * stay until something Today reports on exists - a task, an open job, or a
 * logged activity.
 *
 * Under both of those sits the one row that only a workspace which took "Show
 * me an example" during setup ever sees: the way back out of the sample data.
 * It is deliberately outside the empty/not-empty branch. Loading the example
 * fills the workspace, so the first-run screen is gone by the time the owner
 * wants the example gone, and a button he can only reach by emptying the
 * workspace first is no button at all.
 *
 * Above all of it, in every state, sits the recovery-key card (LR-6): a
 * fresh workspace cannot reach a steady state without the owner having seen
 * the key and confirmed they kept it, and Settings > Backups is a screen a
 * client may never open. It is the one first-run screen with a fourth thing on
 * it rather than a fourth onboarding step, because it is not part of setup —
 * it is a standing condition on every Today until it is met, then gone for
 * good. That includes an existing workspace already in daily use: records and
 * history do not imply anyone was ever shown the key, so the card shows there
 * too until `recoveryKey.confirmedAt` is set, from either this card or
 * `RecoveryKeyPanel` in Settings > Backups (F-CS-1 A9) — one truth, one
 * setting, read by `shouldShowRecoveryKeyCard`. While it is showing it is
 * also the screen's one primary block, which is why the guidance screens'
 * own primary action steps down to secondary underneath it (§5).
 *
 * There are three states, not two (F-CS-1). The CPO audit (F-LA-6) fixed half
 * of "Today lies about what state the workspace is in" — one contact must not
 * blank the screen to six empty panels — but left the other half standing: an
 * owner who imports fifty-two real customers and then opens Today still saw
 * the ORIGINAL first-run screen, "Import a spreadsheet" and all, telling him
 * to do the thing he had just finished doing. `useTodayScreenState()`
 * (src/features/today/lib/useToday.ts) is the one place this is decided:
 *
 *   "empty"   — no contact, no company, nothing due either: the original
 *               three-starter-card first run, unchanged.
 *   "records" — a contact or a company exists (one, or fifty-two off a CSV;
 *               both get the same honest screen) but nothing Today reports on
 *               yet: a different set of starter cards, the next real actions
 *               rather than "import your customers" again.
 *   "active"  — a task, an open job, an activity, a document or a reminder
 *               exists: the real panels.
 */

import type { ReactNode } from "react";
import { Link } from "wouter";
import { navigate } from "wouter/use-browser-location";
import { MagnifyingGlass } from "@/ui/icons";
import { Button, Kbd, PageHeader } from "@/ui";
import { allCommands } from "@/app/registry";
import { useFormats } from "@/app/formats";
import { DueNowSection } from "@/features/today/sections/DueNow";
import { ComingUpSection } from "@/features/today/sections/ComingUp";
import { WeekSummaryLine } from "@/features/today/sections/WeekSummary";
import { NewLeadsSection } from "@/features/today/sections/NewLeads";
import { GoneQuietSection } from "@/features/today/sections/GoneQuiet";
import { RecentActivitySection } from "@/features/today/sections/RecentActivity";
import { ConnectSiteCard } from "@/features/today/sections/ConnectSite";
import {
  RecoveryKeyCard,
  useShowRecoveryKeyCard,
} from "@/features/today/sections/RecoveryKeyCard";
import { openSearch, SEARCH_SHORTCUT } from "@/features/today/search/overlay";
import { useConnectCard, useTodayScreenState } from "@/features/today/lib/useToday";
import { useVocabulary } from "@/app/vocabulary";
import { RemoveSampleDataButton, useHasSampleData } from "@/features/onboarding";
import { UnpaidInvoicesSection } from "@/features/invoices";
import { PollNotice } from "@/features/leads";

/**
 * Quick add belongs to the records agent and is registered as a palette
 * command, so Today runs *that* rather than growing a second copy of the form.
 * Until records ships it, the button takes him to Contacts, which is where he
 * would go next anyway.
 */
function runCommand(id: string, fallback: () => void): void {
  const command = allCommands().find((c) => c.id === id);
  if (command) {
    void command.run();
    return;
  }
  fallback();
}

export function runQuickAdd(): void {
  runCommand("quick-add", () => navigate("/contacts"));
}

/** "Open a job/deal/quote" on the records-state screen. */
export function runNewDeal(): void {
  runCommand("new-deal", () => navigate("/pipeline"));
}

/** "Set a follow-up" on the records-state screen. */
export function runAddFollowUp(): void {
  runCommand("quick-add-task", () => navigate("/tasks"));
}

function todayLabel(locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  } catch {
    return "";
  }
}

/**
 * The panels. `--space-8` between sections rather than a tighter gap: air is
 * what separates a native pane from a web page, and a section heading needs
 * room above it to read as a heading.
 *
 * Coming up sits second, directly under Due now: the two of them are the
 * promises the owner has made, one this week and one this season. Everything
 * below them is information rather than an obligation.
 */
function TodayPanels() {
  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      {/* Renders nothing unless the website poller has something to say, and
          then it says it at the top, where the owner is already looking. */}
      <PollNotice />
      <DueNowSection />
      <ComingUpSection />
      <UnpaidInvoicesSection />
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
  "bg-[var(--color-accent)] px-[var(--space-4)] no-underline",
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

/**
 * The sample-data footer. Draws nothing at all unless the example set is in
 * this workspace, which is what makes it safe to sit under every Today.
 */
function SampleDataNote() {
  const hasSampleData = useHasSampleData();
  if (!hasSampleData) return null;
  return (
    <div className="mt-[var(--space-6)] flex flex-wrap items-center gap-[var(--space-3)] border-t border-[var(--color-border)] pt-[var(--space-4)]">
      <p className="flex-1 text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Some of what you can see is the example Helix put in so the screens had
        something on them. Take it out whenever you like; your own records stay.
      </p>
      <RemoveSampleDataButton size="sm" />
    </div>
  );
}

/**
 * The first-run screen: the three actions that put something on Today.
 *
 * `primary` is false while the recovery-key card is showing above it: the
 * card owns the screen's one primary block then, so "Import a CSV" steps down
 * to the secondary treatment rather than the two of them competing for it.
 */
function FirstRun({ primary }: { primary: boolean }) {
  const vocabulary = useVocabulary();
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="max-w-[var(--content-max)]">
        <h2>
          Nothing here yet, and that is the right place to start
        </h2>
        <p className="mt-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Today shows what is due, which leads nobody has called, and which{" "}
          {vocabulary.lowerMany} have gone quiet. Do one of these three things
          and it fills up on its own.
        </p>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-[var(--space-4)] p-0 lg:grid-cols-3">
        <StarterCard
          title="Import a spreadsheet"
          description="A CSV from your old CRM, your accountant, or a sheet you keep yourself. Five minutes, and you keep every column you care about."
          action={
            <Link
              href="/import"
              className={primary ? primaryLinkClasses : secondaryLinkClasses}
            >
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
          title="Connect a website"
          description="Leads from your website land here on their own. ClearPath sites work straight away; Help covers any other site."
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

/**
 * The second state (F-CS-1): a contact or a company already exists — an
 * import landed, or someone was added by hand — but nothing Today reports on
 * yet. "Nothing here yet" is as false here as it was for the CPO's
 * one-contact case, so this says what is actually true and offers the next
 * real actions instead of the original three: "Import a spreadsheet" is
 * done, so it drops out, and "Connect a website" only stays while the
 * workspace genuinely has none connected.
 *
 * `primary` follows the same rule as `FirstRun`'s: false while the
 * recovery-key card owns the screen's one primary block above it.
 */
function RecordsStarted({ primary }: { primary: boolean }) {
  const vocabulary = useVocabulary();
  const connectCard = useConnectCard();
  const showConnect = connectCard.data ? connectCard.data.siteOrigin === null : false;

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="max-w-[var(--content-max)]">
        <h2>Your customers are in Helix</h2>
        <p className="mt-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          Today starts reporting the moment one of them is moving: a{" "}
          {vocabulary.lower} open, a follow-up on the calendar, or a call
          logged. Pick one below.
        </p>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-[var(--space-4)] p-0 lg:grid-cols-3">
        <StarterCard
          title={`Open a ${vocabulary.lower}`}
          description={`Start one for a customer who is already here. The ${vocabulary.lowerMany} board takes it from there.`}
          action={
            <Button type="button" variant="secondary" onClick={runNewDeal}>
              {`Open a ${vocabulary.lower}`}
            </Button>
          }
        />
        <StarterCard
          title="Set a follow-up"
          description="A date and a name is enough. Today shows it the moment it exists."
          action={
            <Button
              type="button"
              variant={primary ? "primary" : "secondary"}
              onClick={runAddFollowUp}
            >
              Set a follow-up
            </Button>
          }
        />
        <StarterCard
          title="Log a call"
          description="Open a customer's page and log the call, text or note that happened. That is what tells Today something moved."
          action={
            <Link href="/contacts" className={secondaryLinkClasses}>
              Go to your customers
            </Link>
          }
        />
        {showConnect ? (
          <StarterCard
            title="Connect a website"
            description="Leads from your website land here on their own. ClearPath sites work straight away; Help covers any other site."
            action={
              <Link href="/settings/site" className={secondaryLinkClasses}>
                Connect website
              </Link>
            }
          />
        ) : null}
      </ul>
    </div>
  );
}

export function TodayScreen() {
  const { data: screenState, isLoading } = useTodayScreenState();
  const showRecoveryCard = useShowRecoveryKeyCard();
  const formats = useFormats();
  const isActive = screenState === "active";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Today"
        subtitle={
          <>
            {todayLabel(formats.locale)}
            {isActive ? <WeekSummaryLine /> : null}
          </>
        }
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
        {showRecoveryCard ? <RecoveryKeyCard /> : null}
        {isLoading ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : screenState === "empty" ? (
          <FirstRun primary={!showRecoveryCard} />
        ) : screenState === "records" ? (
          <RecordsStarted primary={!showRecoveryCard} />
        ) : (
          <TodayPanels />
        )}
        <SampleDataNote />
      </div>
    </div>
  );
}
