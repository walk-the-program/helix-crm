/**
 * The Help screen's copy, as data.
 *
 * Kept out of the screen so it can be read and unit-tested on its own
 * (tests/unit/help/content.test.ts) and so HelpScreen.tsx stays layout only.
 * Every fact below comes from the real feature code: src/features/data
 * (import, export, backups, attachments, duplicates), src/features/today
 * (the four Today sections), src/features/records (contacts, companies,
 * pipeline, tasks, trash) and src/features/leads (the website connection and
 * reports). Route paths and button labels match those files exactly.
 *
 * Voice: plain words, short sentences, second person, no hype. See
 * docs/DESIGN.md section 11.
 */

export type HelpSection = { id: string; title: string; paragraphs: string[] };

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "customers-in",
    title: "Getting your customers in",
    paragraphs: [
      "Bring your customers in from a spreadsheet, or add them one at a time. Click Import in the sidebar, choose the file, and match your columns to Helix's own list; a name is the only thing you truly need. You will see the first rows of your own file before anything is saved, so you know Helix is reading it right.",
      "Pick how Helix should handle a customer you already have before you start the import, and it writes everything in one step, so if something goes wrong nothing is left half-added. For one customer at a time, press Add a contact on the Today screen, or open Quick add from anywhere.",
    ],
  },
  {
    id: "lead-to-won",
    title: "Working a job from lead to won",
    paragraphs: [
      "A job moves through stages on the Pipeline screen, from a new lead to won or lost. Open a job's page from a board card to see the customer, the price, the next step and everything said so far, all in one place, and change its stage from the menu there.",
      // From lead-records (F-LA-17c), verbatim: the board's keyboard method,
      // which it has always offered and never said out loud. It replaces the
      // old "drag it to a new stage" sentence rather than joining it — the
      // section is held to six sentences, and this one says more.
      "On the jobs board, drag a card to another stage, or focus a card and hold shift with an arrow key to move it.",
      "Moving a job to a lost stage asks you for a reason first, so you remember why later without having to guess.",
      "The Text and Email buttons on a customer each have a small arrow beside them: that picks one of your saved templates, fills in the name, the job and the price, and opens the message ready for you to read and send.",
      "If job is not the word you use, open Settings and go to Vocabulary to call these deals, jobs or quotes instead; the change is instant and only relabels the screen, and nothing about your data moves.",
    ],
  },
  {
    id: "today",
    title: "Today and follow-ups",
    paragraphs: [
      "Today is the first screen you see, and it is built around two questions: what needs you, and who have you not called back. Due now lists every follow-up that is overdue or due today, with a Call button when there is a phone number, plus Done and Snooze. New leads shows anyone who reached out in the last seven days that nobody has called yet; quote requests from your website land here on their own.",
      "Coming up is the work that repeats: set a reminder on a customer, like a spring cleanup every year or a filter change every three months, and it turns up here a week before it is due, with Done and Skip this one beside it. Gone quiet catches open jobs that have gone silent longer than they should, so nothing falls through only because it went cold. Recent activity is the last twenty things logged across every customer and job, so you can answer what you did yesterday without opening a single record.",
    ],
  },
  {
    id: "website-leads",
    title: "Your website's leads",
    paragraphs: [
      "If ClearPath built your website, connect it under Settings, then Website, and quote requests start landing in Helix on their own, each with the message the customer typed. Paste your site's address and the token from its admin page; the token is stored in your Mac Keychain or Windows Credential Manager, never in a Helix file you could lose. Helix checks every few minutes while it is open and once when it starts, Poll now checks straight away, and Test connection checks the address and token already saved, so save a new token before you test it.",
      "When leads stop, that screen names the cause, because each one has a different fix: a token that changed, a website with no lead connection on it yet, a website answering with an error, or no answer at all. Paste a new token and save and Helix carries on from where it stopped, so nothing that arrived meanwhile is lost; if the website has gone for good, disconnect it and nothing is deleted, because every customer, job, note and file it ever sent is already on your machine. The Reports screen shows which sources are actually bringing in the work, so you can see it in numbers instead of guessing.",
    ],
  },
  {
    id: "backups",
    title: "Backups and where your data lives",
    paragraphs: [
      "Helix runs on your computer and does not need the internet for the everyday work; nothing about a customer leaves your machine unless you turn on the optional AI module or connect your website, and even then only what those features need is sent, and only when you ask. Your data lives in one file on your own machine, and Diagnostics, under Settings, shows exactly where it is and how big it has gotten. Helix backs itself up automatically after it opens, unless one has run in the last hour, and every six hours after that, keeping every backup from the last day and then one a day for thirty days.",
      "Go to Settings, then Backups, to see the list, force one with Back up now, or restore an older one if something went wrong; restoring backs up today's data first, so that can be undone too. Attachments, the files you have added to a customer or job, are stored beside the database as plain, unencrypted files, not part of the backup, the same as a photo anywhere else on this computer. If you ever want everything out of Helix, use Export to save a CSV of any list, or all of it at once; an export is a plain file too, so keep it somewhere as safe as you would keep the original.",
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    paragraphs: [
      "Helix answers to a handful of keys so you do not have to reach for the mouse for the things you do most. Press the question mark key anywhere to open the full list, or press Cmd/Ctrl+K to search for a customer, a company or a job by name, phone number or note.",
      "Cmd/Ctrl+N opens Quick add so you can drop in a new contact, job or task without leaving the screen you are on. The button below opens the same list that key does, if you would rather click than remember a shortcut.",
    ],
  },
];

/**
 * Not one of the six in `HELP_SECTIONS` — it is new this round (docs/rounds/
 * 2026-09-20-round-3.md #17), sits between "Your website's leads" and
 * "Backups" on the screen, and is kept as its own export the same way
 * `HELP_TROUBLE` is, so the existing "exactly six sections" contract on
 * `HELP_SECTIONS` still holds.
 *
 * The shape here is the real one: `src/features/leads/lib/types.ts`'s `Lead`
 * and `LeadPage`, and docs/CONTRACTS.md's "Site endpoint contract". Helix
 * polls (`GET`), it does not receive a push, so a site that is not built by
 * ClearPath answers this request rather than calling out to Helix.
 */
export const HELP_WEBSITE_ENDPOINT: HelpSection = {
  id: "website-leads-endpoint",
  title: "Connecting a site Helix didn't build",
  paragraphs: [
    "A website does not have to be built by ClearPath to send its leads to Helix. It needs one endpoint, GET /api/crm/leads, that answers a bearer token in the Authorization header with a 200 response shaped like { leads: [...], nextCursor }. Each lead needs an id, a createdAt, and whatever it has of name, email, phone, service, message and pageUrl; leave a field null rather than leaving it out, list leads oldest first by createdAt then id, and cap a page at 200.",
    "Paste your site's address and that token under Settings, then Website, the same as a ClearPath site. Helix stores the token in your Mac Keychain or Windows Credential Manager and sends it back as the bearer token on every request; it is never written to a file you could lose. Helix polls this endpoint on its own, once when it starts and every few minutes after, so your site never has to reach out to Helix. It only has to answer when Helix asks, and hand back the cursor it was given as after on the next page.",
  ],
};

/**
 * Not one of the six in `HELP_SECTIONS` for the same reason
 * `HELP_WEBSITE_ENDPOINT` is not: it is new this round (SEC audit, launch
 * round 2026-09-20, acceptance A4), spliced in right after "Backups and where
 * your data lives" on the screen, and kept as its own export so the existing
 * "exactly six sections" contract in tests/unit/help/content.test.ts still
 * holds. `src/features/settings/components/WorkspacesScreen.tsx` names this
 * section by its title, so the two must stay in sync.
 */
export const HELP_WORKSPACE_REMOVAL: HelpSection = {
  id: "workspace-removal",
  title: "Removing a workspace for good",
  paragraphs: [
    "Archiving a workspace, under Settings then Workspaces, takes it out of the switcher and stops it checking for leads or backing itself up; it does not delete anything, which is why it is the right choice whenever there is any chance you will want that business back. There is no button in Helix that deletes a workspace's files - that is deliberate, the same reason a deleted record sits in Trash for thirty days rather than vanishing the moment you click delete.",
    "When a client's relationship with you has genuinely ended and nothing of theirs should remain, archive the workspace first, close Helix, then delete that workspace's folder yourself; Diagnostics, under Settings, names the exact file, one level up from it. Deleting that folder removes the database, its backups and every attached file in one step. One small technical leftover cannot be helped: the saved key that unlocked that database can stay in your Mac Keychain or Windows Credential Manager after the folder is gone, and it names nothing about your customers; remove it by hand there if you want it gone too.",
  ],
};

export const HELP_TROUBLE: HelpSection = {
  id: "trouble",
  title: "Something's wrong?",
  paragraphs: [
    "Start with Diagnostics, under Settings; it shows where your data lives, how big the file is, and the log of what Helix last did, along with a button to copy that log. If something is actually broken, report it on GitHub at https://github.com/walk-the-program/helix-crm/issues, and include what you were doing right before it happened, plus the copied log. Helix has no support team watching in the background, so this page and that log are how a problem actually gets fixed. The log itself names when Helix started, backed up, checked your website or hit an error, and your connected website's address; it does not name a customer.",
  ],
};

export const ISSUES_URL = "https://github.com/walk-the-program/helix-crm/issues";
