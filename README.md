<p align="center"><img src="assets/brand/helix-logo.png" width="120" alt="Helix CRM"></p>

# Helix CRM

Helix CRM is a desktop CRM for people who run a trade or service business on
their own: landscapers, dentists, med spas, home services, gyms, churches,
restaurants, venues. It keeps every contact, job, and follow-up in one file
on your own computer, with no account, no monthly login, and no cloud in
between. If your website was built by ClearPath, its leads can land in Helix
automatically the moment someone fills out your quote form.

Helix is open source under the AGPL-3.0 license. Anyone can read the code,
run it, and change it.

## Who it's for

One owner, one laptop, one business (or a few). You already trust QuickBooks
and your bank's app; Helix is built to feel that ordinary. It is not an
"AI-first" product. AI is a settings toggle you can ignore completely.

## What it does

- **Contacts**: names, phones, emails, addresses, tags, and your own custom
  fields, all searchable instantly.
- **Companies**: see every person, every job, and the whole shared history
  for a business in one place.
- **Pipeline**: drag jobs between stages on a board, or work them as a list.
  Call the stages Deals, Jobs, or Quotes, whatever fits your business.
- **Timeline**: every call, email, note, and text on a contact, company, or
  job, in one running record.
- **Tasks and follow-ups**: a due date, a done checkbox, snooze to tomorrow
  or next week. Nothing fancier than that.
- **Today screen**: what's due, new leads from the last week, and who's gone
  quiet, the moment you open the app.
- **Instant search**: press Cmd/Ctrl+K and start typing. Results come back
  in well under a tenth of a second, even with tens of thousands of records.
- **Quick add**: one shortcut, one form, back to work.
- **CSV import**: drop in an export from HubSpot, Zoho, Pipedrive, Google
  Contacts, or Excel. Helix guesses the column mapping and shows you a
  preview before writing anything.
- **Website leads**: if your site was built by ClearPath, quote-form
  submissions become contacts and jobs in Helix on their own, checked every
  five minutes while the app is open.
- **Gone-quiet alerts**: Helix flags a job nobody has touched in two weeks
  (you can change the number, or turn it off per stage).
- **One-tap actions**: call, text, email, or get directions straight from a
  phone number or address, with a one-click "log this" after.
- **Saved views**: name a filter and pin it to the sidebar so it's one click
  away.
- **Reports**: pipeline value by stage, wins and losses, where your leads
  come from, and how long jobs sit in each stage, as charts and tables.
- **Duplicate detection**: Helix finds the same person entered twice and
  walks you through merging them, with a 30-day undo.
- **Attachments**: drop in a photo, a signed quote, or a contract. It's
  copied next to your data, and images show a thumbnail.
- **Export and backup**: export any list, or everything as CSV and JSON.
  Helix backs itself up automatically after launch and every six hours while
  open, and keeps 30 days of history.
- **Undo and trash**: every delete can be undone for ten seconds, and
  nothing is gone for good for 30 days.
- **Settings**: rename Deals to Jobs or Quotes, add your own fields and
  tags, pick light or dark and a comfortable or compact layout, and run more
  than one business.

### Workspaces

Run several businesses from the same install. Each one is its own SQLite
file, switched from the sidebar. Only the workspace you have open checks for
new leads or backs itself up.

### Optional AI module

Off by default. If you turn it on, you bring your own Anthropic API key
(from console.anthropic.com), stored in your operating system's keychain,
never in Helix's database or settings file. Three things it can do, only
when you press a button:

- Paste an email, text, or voicemail transcript and get a contact and job
  ready for you to review and save.
- Draft a follow-up email from a job's timeline, which opens in your mail
  app. Helix never sends anything itself.
- Summarize a contact, company, or job in a few sentences.

Each request sends only the one record on screen. Nothing runs in the
background, and nothing is sent until you ask for it. You choose the model:
Sonnet 5 (the default), Opus 5, or Haiku 4.5.

## Installing

Download the latest release from this repository's Releases page.

**v1 builds are not code-signed.** That costs money and time Helix doesn't
have yet (see the changelog's "Not in v1" list), so both operating systems
will warn you the first time you open it. This is expected; it isn't a sign
anything is wrong.

### macOS

1. Download the `.dmg` for your Mac (`aarch64` for Apple Silicon, `x86_64`
   for an Intel Mac) and drag Helix CRM into Applications.
2. The first time you open it, macOS will refuse to launch it with a plain
   double-click. **Right-click the app and choose Open**, then confirm in the
   dialog that appears. You only need to do this once.
3. Because the build is unsigned, every update gets a new, unrecognized app
   identity as far as macOS is concerned. Expect **a Keychain access prompt
   after each update** when Helix reads your site token or Anthropic key.
   Click Allow. This goes away once signed builds ship.

### Windows

1. Download the `.msi` or `.exe` installer and run it.
2. Windows SmartScreen will say it protected your PC. Click **More info**,
   then **Run anyway**.

## First run

On first launch, Helix creates a workspace for you and opens straight to the
Today screen, empty, with three things to get you started: import a CSV, add
your first contact, or connect your website. There's nothing to configure
before you can use it.

## Importing your data

From the Import screen (or the "Import a CSV" command), drop in an export
from HubSpot, Zoho, Pipedrive, Google Contacts, or Excel. Helix detects the
file's encoding and delimiter, guesses which column is which, and shows you
a preview before writing anything. You choose what happens to duplicates
(skip, update, or create anyway), matched by email first and then phone.

## Connecting a ClearPath website

If your website was built from a ClearPath template, it can send its
quote-form leads straight into Helix.

1. On the site, set the `CRM_API_TOKEN` environment variable to a long
   random string (`openssl rand -base64 32` works well). Leaving it unset
   keeps the lead endpoint turned off.
2. In Helix, go to **Settings → Site connection** and enter that site's
   address and the same token.
3. Click **Test connection**. Helix checks in every five minutes while it's
   open and turns each new lead into a contact and a job in your first
   pipeline stage, with the original message kept on its timeline.

If the token is wrong, Helix shows a banner telling you to check it rather
than failing silently.

## Where your data lives

Everything stays on your machine. Each workspace is one SQLite file:

- macOS: `~/Library/Application Support/com.clearpathdigital.helix/workspaces/<workspace>/helix.db`
- Windows: `%APPDATA%\com.clearpathdigital.helix\workspaces\<workspace>\helix.db`

Backups live in a `backups` folder next to that file, and attachments in an
`attachments` folder beside it. The list of your workspaces is kept in
`helix.json` in the same app data folder. Nothing leaves your computer
unless you turn on the AI module or connect a website, and even then, only
the data those features need is sent, only when you ask.

The database file itself isn't encrypted; that's what your operating
system's full-disk encryption (FileVault, BitLocker) is for.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `Cmd/Ctrl + K` | Search everything |
| `Cmd/Ctrl + Shift + K` | Open the command palette |
| `Cmd/Ctrl + /` | Search (alternate key) |
| `Cmd/Ctrl + N` | Quick add a contact, company, job, task, or note |
| `Cmd/Ctrl + Shift + V` | Paste an email or text into a record (AI, when turned on) |
| `Cmd/Ctrl + ,` | Open settings |
| `?` | Show the keyboard shortcuts sheet |

## Development

You'll need:

- Node 26
- Rust, installed via [rustup](https://rustup.rs)

```sh
npm install
npm run tauri dev    # runs the app with hot reload
npm test              # unit and repository tests (Vitest)
npm run e2e:mac        # end-to-end tests against a mocked Tauri layer (macOS)
```

See `CONTRIBUTING.md` for the repository layout, the rules that keep several
people working on this codebase without stepping on each other, and how to
run every test suite.

## License

Helix CRM is licensed under the GNU Affero General Public License v3.0. See
[`LICENSE`](./LICENSE) for the full text.

---

Made by ClearPath Digital, which also builds the websites Helix pulls leads
from.
