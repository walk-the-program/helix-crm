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
 *    for mailto: links. The URL is also printed as plain text beside the
 *    button so the owner can type it into another machine by hand.
 *
 * One hairline, at most, separates the everyday sections from the "something
 * is wrong" one; every other gap is air, not a rule.
 */
import { Fragment } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { navigate } from "wouter/use-browser-location";
import { Button, PageHeader, toast } from "@/ui";
import { findCommand } from "@/app/registry";
import {
  HELP_SECTIONS,
  HELP_TROUBLE,
  HELP_WEBSITE_ENDPOINT,
  ISSUES_URL,
  type HelpSection,
} from "@/features/help/lib/content";

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
    // webview to GitHub and leave the owner with no way back. The URL is
    // already printed beside the button, so say so and let him type it.
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

function HelpSectionBlock(props: { section: HelpSection }) {
  const { section } = props;
  return (
    <section id={section.id} className="flex flex-col gap-[var(--space-3)]">
      <h2>{section.title}</h2>
      <Paragraphs paragraphs={section.paragraphs} />
      {section.id === "shortcuts" ? (
        <div className="mt-[var(--space-1)]">
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
      className="flex flex-col gap-[var(--space-3)] border-t border-[var(--color-border)] pt-[var(--space-6)]"
    >
      <h2>{HELP_TROUBLE.title}</h2>
      <Paragraphs paragraphs={HELP_TROUBLE.paragraphs} />
      <div className="mt-[var(--space-1)] flex flex-col gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/settings/diagnostics")}
          >
            Open Diagnostics
          </Button>
          <Button type="button" variant="secondary" onClick={() => void openIssues()}>
            Report an issue on GitHub
          </Button>
        </div>
        <p className="break-all text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {ISSUES_URL}
        </p>
      </div>
    </section>
  );
}

export function HelpScreen() {
  return (
    <div data-testid="help-screen" className="flex flex-col">
      <PageHeader
        title="Help"
        subtitle="Short answers to the things owners ask about Helix most."
      />

      <div className="flex max-w-[var(--content-max)] flex-col gap-[var(--space-8)]">
        {HELP_SECTIONS.map((section) => (
          <Fragment key={section.id}>
            <HelpSectionBlock section={section} />
            {section.id === "website-leads" ? (
              <HelpSectionBlock section={HELP_WEBSITE_ENDPOINT} />
            ) : null}
          </Fragment>
        ))}
        <TroubleSection />
      </div>
    </div>
  );
}
