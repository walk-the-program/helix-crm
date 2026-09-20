/**
 * Help: one calm reading screen, not a wizard and not a search box.
 *
 * The owner this product is built for (docs/DESIGN.md, design/research.md) is
 * not going to read documentation for its own sake — he opens this page once,
 * scans for the paragraph that answers the thing in front of him, and leaves.
 * So there is no table of contents (a handful of short sections do not need
 * one), no card-on-card stacking, and no illustration: just a title, a
 * heading and two short paragraphs per topic, in the same column width the
 * eye already reads prose in (`--content-max`, the guide's 60-75 character
 * measure).
 *
 * The copy itself lives in lib/content.ts as data, not in this file, so it
 * can be unit-tested without rendering anything and so this component stays
 * layout only. `HELP_WEBSITE_ENDPOINT` (docs/rounds/2026-09-20-round-3.md
 * #17) is one such section that is not part of `HELP_SECTIONS`: it is
 * spliced in right after "Your website's leads" so `HELP_SECTIONS` can keep
 * its own six-item contract in tests/unit/help/content.test.ts.
 * `HELP_WORKSPACE_REMOVAL` (SEC audit, launch round 2026-09-20) is the same
 * shape, spliced in right after "Backups and where your data lives"; the
 * Workspaces settings screen points here by the section's own title.
 * `HELP_INVOICES` (LR-CS-W3) is the same shape again, spliced in right after
 * "Working a job from lead to won" - the section that already explains
 * winning a job, so quotes and invoices follow it rather than sitting apart.
 *
 * Deep-linking: a few screens outside this one now link straight to a
 * section here (an empty state on Invoices, a failed website connection, the
 * Diagnostics screen) rather than only sending the owner to Help and leaving
 * him to scroll. `navigate("/help#<id>")` changes the URL's hash but nothing
 * about a client-side route change makes the browser scroll to it, so this
 * screen does that itself on mount - the smallest version of this that works,
 * not a router feature or a scroll-restoration library.
 *
 * Two sections carry a real action instead of just words:
 *  - "Keyboard shortcuts" opens the same sheet the "?" key does. It looks the
 *    command up at click time through the registry (`findCommand`), the only
 *    supported seam into another feature, and falls back to the settings
 *    route if the command is ever missing.
 *  - "Something's wrong?" links to Diagnostics (a normal in-app route) and to
 *    the GitHub issues page. The issues link is external, so it goes through
 *    the OS opener rather than a bare href that would navigate the whole
 *    webview away from the app — the same pattern DraftFollowUpButton uses
 *    for mailto: links. The URL is the button's `title` rather than a line of
 *    text on the page, and the toast that fires if the browser refuses to open
 *    prints it in full — the one moment it is needed.
 *
 * One hairline, at most, separates the everyday sections from the "something
 * is wrong" one; every other gap is air, not a rule.
 */
import { Fragment, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { navigate } from "wouter/use-browser-location";
import { Button, PageHeader, toast } from "@/ui";
import { findCommand } from "@/app/registry";
import {
  HELP_GETTING_STARTED,
  HELP_INVOICES,
  HELP_SECTIONS,
  HELP_TROUBLE,
  HELP_WEBSITE_ENDPOINT,
  HELP_WORKSPACE_REMOVAL,
  ISSUES_URL,
  type HelpSection,
} from "@/features/help/lib/content";

/**
 * Scroll a section into view when the URL already names one, e.g. a link
 * from an Invoices empty state to "/help#quotes-invoices". A hash change from
 * `navigate()` (a `pushState`, not a real page load) never scrolls the
 * browser on its own, so this is the one thing this screen has to do itself.
 */
function useScrollToHash(): void {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, []);
}

/** Runs the registered shortcuts command, or navigates there if it is gone. */
function openShortcuts(): void {
  const command = findCommand("show-shortcuts");
  if (command) {
    void command.run();
    return;
  }
  navigate("/settings/shortcuts");
}

async function openIssues(): Promise<void> {
  try {
    await openUrl(ISSUES_URL);
  } catch {
    // Never `window.location` as a fallback: that would navigate the app's own
    // webview to GitHub and leave the owner with no way back. Say the address
    // instead, which is the only place it needs to be spelled out.
    toast.error(`Your browser did not open. The address is ${ISSUES_URL}`);
  }
}

function Paragraphs(props: { paragraphs: string[] }) {
  return (
    <>
      {props.paragraphs.map((paragraph, i) => (
        <p
          key={i}
          className="text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--color-text-muted)]"
        >
          {paragraph}
        </p>
      ))}
    </>
  );
}

/**
 * A heading sits closer to its own paragraphs than the paragraphs sit to each
 * other, or it reads as floating between two bodies of text rather than
 * belonging to the one below it. Both gaps used to be `--space-3` and the
 * hierarchy went flat at every width.
 */
function HelpSectionBlock(props: { section: HelpSection }) {
  const { section } = props;
  return (
    <section id={section.id} className="flex flex-col gap-[var(--space-2)]">
      <h2>{section.title}</h2>
      <div className="flex flex-col gap-[var(--space-3)]">
        <Paragraphs paragraphs={section.paragraphs} />
      </div>
      {section.id === "shortcuts" ? (
        <div className="mt-[var(--space-2)]">
          <Button type="button" variant="secondary" onClick={openShortcuts}>
            Show the shortcuts
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function TroubleSection() {
  return (
    <section
      id={HELP_TROUBLE.id}
      className="flex flex-col gap-[var(--space-2)] border-t border-[var(--color-border)] pt-[var(--space-6)]"
    >
      <h2>{HELP_TROUBLE.title}</h2>
      <div className="flex flex-col gap-[var(--space-3)]">
        <Paragraphs paragraphs={HELP_TROUBLE.paragraphs} />
      </div>
      {/*
        The address used to be printed underneath as a line of `break-all`
        faint text, so the owner could type it into another machine by hand.
        Nobody types a GitHub issues URL by hand, and a raw URL sitting on a
        page is the kind of permanent explanation the design direction is
        against (rule 3). It is the button's `title` instead, and the toast
        that fires when the browser refuses to open still prints it in full —
        which is the one moment it is actually needed.
      */}
      <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-3)]">
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate("/settings/diagnostics")}
        >
          Open Diagnostics
        </Button>
        <Button
          type="button"
          variant="secondary"
          title={ISSUES_URL}
          onClick={() => void openIssues()}
        >
          Report an issue on GitHub
        </Button>
      </div>
    </section>
  );
}

export function HelpScreen() {
  useScrollToHash();
  return (
    <div data-testid="help-screen" className="flex flex-col">
      <PageHeader
        title="Help"
        subtitle="Short answers to the things owners ask about Helix most."
      />

      <div className="flex max-w-[var(--content-max)] flex-col gap-[var(--space-8)]">
        <HelpSectionBlock section={HELP_GETTING_STARTED} />
        {HELP_SECTIONS.map((section) => (
          <Fragment key={section.id}>
            <HelpSectionBlock section={section} />
            {section.id === "lead-to-won" ? (
              <HelpSectionBlock section={HELP_INVOICES} />
            ) : null}
            {section.id === "website-leads" ? (
              <HelpSectionBlock section={HELP_WEBSITE_ENDPOINT} />
            ) : null}
            {section.id === "backups" ? (
              <HelpSectionBlock section={HELP_WORKSPACE_REMOVAL} />
            ) : null}
          </Fragment>
        ))}
        <TroubleSection />
      </div>
    </div>
  );
}
