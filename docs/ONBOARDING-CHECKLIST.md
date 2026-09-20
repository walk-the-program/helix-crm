# Onboarding checklist — Walker's install day

Internal. This is the checklist Walker runs on a client's own machine, in
person or on a screen share, the day their Helix goes in. It names every
prerequisite a first-time owner would not know to expect, in the order they
actually hit it, at this revision.

It does not repeat a procedure `docs/OPERATIONS.md` already owns — where one
applies, this points at it by name instead of restating it, so the two files
cannot drift apart. It does not repeat the per-client effort numbers either;
those live in `docs/rounds/launch-returns/rev.md` §3, and are cited here only
where a number changes what this checklist tells Walker to expect.

## Before you arrive

- [ ] The client's site is live and its lead endpoint is issued: run
      `docs/OPERATIONS.md` **CL-1** end to end (generate the token, set
      `CRM_API_TOKEN` on the deployed site, redeploy, confirm both `curl`
      checks) *before* install day, not during it. Install day is for
      handing the token to Helix, not for generating one live in front of a
      client — CL-1's own hand-over order says why (best: it never travels
      further than this screen).
- [ ] Download the current installer yourself and have it on the machine you
      are installing from (a USB stick, or a link you can open on the
      client's own connection) rather than depending on their network to
      pull it down live.
- [ ] Add a blank row for this client to the roster
      (`docs/CLIENT-ROSTER-TEMPLATE.md`; the recommended location is *not*
      in this repository — see that file). Fill the whole row today; a
      column that only records intent when left blank is worse than no
      column (`docs/OPERATIONS.md` **CL-6**).

## On the machine, before Helix ever opens

These are the two prerequisites nothing in Helix explains, because they are
the operating system talking, not the app — a client who has never seen
either will otherwise assume the download is broken or infected.

- [ ] **macOS: Gatekeeper refuses a double-click.** Right-click (or
      Control-click) the app and choose **Open**, then confirm the dialog
      that appears only for this path. This is expected for every unsigned
      build (`tests/RELEASE-CHECKLIST.md` "Keychain and secrets"; TODO E5,
      code signing, is an unresolved spending decision — rev.md §3, D-4)
      and will happen again on every future update, not just this one. Say
      that out loud now so the client is not surprised on the next release.
- [ ] **Windows: SmartScreen warns "Windows protected your PC."** Click
      "More info," then "Run anyway." Same cause, same recurrence, same
      thing to say.

## First launch: the setup screens

- [ ] Helix opens straight into its three-screen setup, not a blank window:
      business name and trade, then the trade's pipeline/sources/price list,
      then how customers come in. There is no separate "create a workspace"
      step to do by hand.
- [ ] **The Keychain prompt appears the moment a secret is first written**
      (the site token below, or later an Anthropic key) — an OS Keychain
      access dialog on macOS, a Credential Manager one on Windows, because
      the build is unsigned. Choose **Always Allow**, not "Allow" or "Deny."
      "Allow" re-prompts on the very next launch; "Deny" sends the client to
      a boot screen instead of the app (`docs/OPERATIONS.md` **procedure
      9**, "The keychain prompt was denied"). This will happen again on
      every future update for the same signing reason as Gatekeeper above —
      one client-facing prompt, twice, is worth mentioning once here rather
      than debugging live twice.
- [ ] On the third setup screen, pick **Import a spreadsheet** if the
      client has a CSV ready today, **Connect a website** if the ClearPath
      site's token is ready (see below), **Show me an example** only for a
      client who wants to see the screens full before touching real data,
      or **Start empty**. Whichever is picked, setup is finished the moment
      the choice lands — none of the four is a trap, and the other three
      stay available afterward from their own screens.

## The recovery key — verify with the lead before release

- [ ] **Verify this line is still accurate before shipping the release you
      install with:** the first thing Today shows, before its regular
      sections, is a recovery-key card that will not go away on its own. It
      stays in front of the client until they reveal the key and confirm
      they copied, saved or printed it — there is no dismiss and no snooze
      (`src/features/today/sections/RecoveryKeyCard.tsx`, LR-6). Stay with
      the client through this step; do not let them close Helix with the
      card still showing and assume it is done. This is the fix for
      F-OPS-1 (a dead laptop makes every encrypted backup unreadable
      without this key) actually reaching a client who never opens
      Settings, and at this revision it depends on the LR-CS-W1 worker's
      change landing and being accepted — confirm that with the lead
      before you rely on this step in front of a client.
- [ ] Whatever the client does with the key once confirmed (write it down,
      keep the file, print it) is theirs to keep somewhere other than "only
      inside Helix" — a recovery key kept solely on the same dead laptop
      recovers nothing.

## Backups: the second copy

- [ ] Go to **Settings → Backups** and choose a second backup folder — an
      existing iCloud Drive, Dropbox or OneDrive folder the client already
      has is the easiest honest answer, and it costs Helix no network call
      of its own (`docs/rounds/launch-returns/rev.md` §3 lists this as a
      manual install-day step until a future round prompts for it inline;
      not implemented at this revision). Skipping this leaves the client
      with only the automatic local backups on the one machine.
- [ ] Confirm at least one backup has actually run: **Settings →
      Diagnostics**, "Last backup" should read a time, not "No backup has
      run yet." If it does not, do not leave without finding out why —
      `docs/OPERATIONS.md` **procedure 7** ("Restore a database from a
      backup") is the fix for a backup gone wrong, not for one that never
      ran.

## The site token

- [ ] Paste the address and the token you generated under "Before you
      arrive" into **Settings → Website**, in person, straight from the
      site's environment settings into this screen — the hand-over order
      CL-1 recommends, and the only one where the token never travels
      anywhere else. Press **Test connection** and confirm it succeeds
      before you consider this step done.
- [ ] If the client is self-installing instead of you being there (see
      "What Walker still has to do," below, on why this is the worse
      path): do not paste the token into a shared document, a ticket, or
      the roster. Send it by whatever channel the client already uses for
      business, in a message containing only the token — CL-1's fallback
      order, in the order it lists them.

## The CSV import, if this client has one

- [ ] From the Import screen, drop in the client's export (QuickBooks,
      Jobber, HubSpot, Google Contacts, or a spreadsheet they keep by
      hand). Walk through the column mapping with them rather than
      accepting Helix's guesses unread — a name is the only column Helix
      truly requires, and everything else is a guess worth a second look
      once, in front of the person who knows the data.
- [ ] Pick a duplicate-handling choice (skip, update, or create anyway)
      before running it; the whole import writes as one step, so a mistake
      here is not a partial mess to clean up by hand, but it is still
      easier to choose right once than to re-run it.

## Before you leave

- [ ] Confirm the banner on **Settings → Website** (if connected) says
      nothing is wrong, or explain to the client what it says and that
      it will heal on its own if the cause is on the site's side
      (`docs/OPERATIONS.md` **CL-3**).
- [ ] Update the roster row: install date, Helix version actually running
      (confirmed, not just downloaded — `docs/OPERATIONS.md` **CL-6**
      is explicit that a column recording intent is worse than none), how
      the token was handed over, and which of the four setup-screen-3
      choices the client picked.
- [ ] Tell the client, in your own words, what support looks like: there is
      no in-app support channel by design, Help's own "Something's wrong?"
      section names it plainly, and the two things you will ask for on a
      call are what the Settings → Website banner says and what "Last
      result" says — usually enough on its own (`docs/OPERATIONS.md` **CL-7**).

## What Walker still has to do for this client, after today

Per-event detail and time estimates for all of this are
`docs/rounds/launch-returns/rev.md` §3's table; this is the checklist
version, not a second copy of the numbers.

- Rotate or re-issue the token if it is ever compromised, the client's
  machine is lost or sold, or the arrangement changes (`docs/OPERATIONS.md`
  **CL-2**).
- Tell the client when a new Helix version exists — there is no auto-update
  and no in-app notice, by design, so this genuinely does not happen unless
  Walker does it (`docs/OPERATIONS.md`, founder-task inventory, item 4).
- Diagnose a failed lead connection from the banner and "Last result" text
  the client reads back, and fix whatever is on the site's side
  (`docs/OPERATIONS.md` **CL-3**).
- Handle the site address changing (staging to live, a rebrand, apex to
  www) — tell the client which of the two address-change choices to pick
  *before* they change it (`docs/OPERATIONS.md` **CL-4**).
- Offboard the client cleanly if the site relationship ends: rotate or
  remove the token, tell them plainly what they keep (everything — Helix is
  theirs, free, and does not stop working), and update the roster
  (`docs/OPERATIONS.md` **CL-5**).
- Keep the roster current as the one record of which client runs what,
  since Helix itself has no telemetry to ask instead
  (`docs/OPERATIONS.md` **CL-6**).

## What the client can do alone, from day one

- Everything that is not the site token or a machine-level prerequisite:
  add, edit and search contacts and companies; move jobs through the
  pipeline; raise quotes and invoices and mark them paid; set reminders;
  attach files; run their own CSV imports later; restore from a backup;
  export their own data; and use Help's own screen for all of the above —
  it is written for exactly this audience (`src/features/help/**`).
- Choosing a new backup folder, or moving it, without Walker if their
  storage situation changes.
- Deciding on their own to load or remove the sample data, at any time —
  not only during setup.
